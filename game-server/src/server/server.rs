use server::server::ServerEvent::Updated;
use std::io::BufReader;
use std::io::prelude::*;
use model::UserId;
use model::User;
use rand::Rng;
use server::task;
use model::Event;
use std::net::Shutdown;
use std::time::Duration;
use model::{Task, TaskResult, TaskRequest, GameServer};
use redis::Commands;
use error::Error;
use ticker::Ticker;
use game::{Game, Player, Board, Cord, Stone};
use std::sync::mpsc::Sender;
use std::sync::mpsc::channel;
use std::sync::mpsc::Receiver;
use redis::{Client, PubSub};
use uuid::Uuid;
use std::net::{TcpStream, TcpListener};
use model::{parse_command, Command, Invite};
use server::room::Room;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::io::{Read, Write};
use std::thread;
use server::cmd;

pub enum ServerEvent {
    Connect{ conn_id: Uuid, conn: TcpStream },
    Close { conn_id: Uuid },
    Updated,
    Command { conn_id: Uuid, cmd: Command },
    TaskRequest { task_request: TaskRequest }
}

#[derive(Clone, Debug)]
pub struct Connection {
    pub conn_id: Uuid,
    pub user_id: UserId,
    pub room_id: Option<String>
}

pub struct Server {
    tx: Option<Sender<ServerEvent>>,
    addr: String,
    pub real_addr: String,
    pub name: String,
    pub redis: Client,
    pub rooms: HashMap<String, Room>,
    pub invites: HashMap<String, Invite>,
    pub conns: HashMap<Uuid, Connection>,
    pub streams: HashMap<Uuid, TcpStream>
}

const redis_server_hash: &'static str = "game_server_hash";
const redis_result_pubsub: &'static str = "task_result_pub_sub";
const redis_lobby_queue: &'static str = "task_lobby_queue";

fn redis_game_queue(server: &str) -> String {
    format!("task_game_queue_{}", server)
} 

fn redis_result_channel(id: &str) -> String {
    format!("task_result_chan_{}", id)
} 

impl Server {
    pub fn new(addr: &str, name: &str, real_addr: &str, redis_addr: &str) -> Self {
        Self {
            tx: None,
            name: name.to_owned(),
            addr: addr.to_owned(),
            real_addr: real_addr.to_owned(),
            redis: Client::open(redis_addr).unwrap(),
            rooms: HashMap::new(),
            invites: HashMap::new(),
            conns: HashMap::new(),
            streams: HashMap::new()
        }
    }

    pub fn get_invite_of_user(&self, user_id: UserId, room_id: &str) -> Option<Invite> {
        match self.invites.iter().find(|(_, x)| x.user_id == user_id && x.room_id == room_id) {
            Some((_, x)) => Some(x.clone()),
            None => None
        }
    }

    pub fn update_discover(&self) -> Result<(), Error> {
        let conn = self.redis.get_connection()?;
        let game_server = GameServer::from_server(self);
        let buf = serde_json::to_string(&game_server)?;
        let _: () = conn.hset(redis_server_hash, &self.name, &buf)?;
        Ok(())
    }

    pub fn tx(&self) -> &Sender<ServerEvent> {
        self.tx.as_ref().unwrap()
    }

    pub fn make_tx(&self) -> Sender<ServerEvent> {
        let tx = self.tx.as_ref().unwrap();
        tx.clone()
    }

    pub fn serve(mut self) {
        for event in self.listen().iter() {
            self.handle_event(event);
        }
    }

    fn handle_event(&mut self, event: ServerEvent) -> Result<(), Error> {
        match event {
            ServerEvent::Connect { conn_id, conn } => {
                info!("client({}) connected", conn_id);
                self.conns.insert(conn_id, Connection {
                    conn_id: conn_id,
                    user_id: UserId::empty,
                    room_id: None
                });
                self.streams.insert(conn_id, conn);
            },
            ServerEvent::Command { conn_id, cmd } => {
                let conn = { 
                    self.conns.get(&conn_id).unwrap().clone()
                };
                if let Err(err) = cmd::handle(self, &conn, &cmd) {
                    self.dispatch(conn_id, &Event::Error{message: format!("{}", err)});
                };
            },
            ServerEvent::Updated => {
                self.update_discover()?;
            },
            ServerEvent::TaskRequest { task_request } => {
                match task::handle(self, task_request.task) {
                    Ok(res) => {
                        info!("task({}) was successful: {}", task_request.id, res);
                        self.send_result(&task_request.id, &TaskResult{
                            error: None,
                            value: res
                        });
                    },
                    Err(e) => {
                        info!("task({}) encounterd an error: {}", task_request.id, e);
                        self.send_result(&task_request.id, &TaskResult{
                            error: Some(format!("{}", e)),
                            value: "".to_owned()
                        });
                    }
                };
            },
            ServerEvent::Close { conn_id } => {
                info!("client({}) disconnected", conn_id);
                let (room_id, user_id, user_len, conf) = {
                    let conn = self.conns.get(&conn_id)?;
                    let room_id = conn.room_id.as_ref()?;
                    let user_id = conn.user_id;
                    let mut room = self.rooms.get_mut(room_id)?;
                    room.users.remove(&conn_id);

                    let user_len = room.users.len();
                    let old = room.conf.clone();
                    if user_id == room.conf.king && user_len != 0 {
                        let values = room.users.values().collect::<Vec<_>>();
                        room.conf.king = rand::thread_rng().choose(&values).unwrap().user_id;
                    }
                    if user_id == room.conf.black {
                        room.conf.black = UserId::empty;
                    }
                    if user_id == room.conf.white {
                        room.conf.white = UserId::empty;
                    }
                    (room_id.clone(), user_id, user_len, if old != room.conf { Some(room.conf.clone()) } else { None })
                };
                if user_len == 0 {
                    self.delete_room(&room_id)
                } else {
                    self.broadcast(&room_id, &Event::Left {
                        user: user_id
                    });
                    if let Some(conf) = conf {
                        self.broadcast(&room_id, &Event::Confed{
                            conf: conf
                        });
                    }
                }
                self.streams.remove(&conn_id);
                self.conns.remove(&conn_id);
                self.update_discover()?;
            }
        }
        Ok(())
    }

    pub fn delete_room(&mut self, room_id: &str) {
        self.rooms.remove(&room_id.to_owned());
        let keys = self.invites.iter()
            .filter(|(_,x)| x.room_id == room_id)
            .map(|(k,_)| k.clone())
            .collect::<Vec<_>>();
        keys.iter().for_each(|x| {
            self.rooms.remove(x);
        });
    }

    pub fn get_room(&self, conn: &Connection) -> Result<&Room, Error> {
        let room_id = match conn.room_id {
            Some(ref x) => x,
            None => return Err(Error::Permission)
        };
        Ok(self.rooms.get(room_id)?)
    }

    pub fn get_room_mut(&mut self, conn: &Connection) -> Result<&mut Room, Error> {
        let room_id = match conn.room_id {
            Some(ref x) => x,
            None => return Err(Error::Permission)
        };
        Ok(self.rooms.get_mut(room_id)?)
    }
    
    pub fn dispatch(&mut self, conn_id: Uuid, event: &Event) {
        if let Some(stream) = self.streams.get_mut(&conn_id) {
            let msg = serde_json::to_string(&event).unwrap() + "\n";
            info!("client({}) will receive msg: {}", conn_id, msg);
            stream.write(msg.as_bytes());
            stream.flush();
        }
    }

    pub fn broadcast(&mut self, room_id: &str, event: &Event) {
        let conn_ids = {
            let room = self.rooms.get(room_id).unwrap();
            room.users.iter().map(|t| t.1.conn_id.clone()).collect::<Vec<_>>()
        };
        conn_ids.iter().for_each(|conn_id| self.dispatch(*conn_id, &event));
    }

    pub fn kick(&mut self, conn_id: Uuid) {
        if let Some(stream) = self.streams.get(&conn_id) {
            stream.shutdown(Shutdown::Both);
        }
    }

    fn ping_update(&self) {
        let tx = self.make_tx();
        thread::spawn(move || {
            tx.send(Updated);
            for _ in Ticker::new(0.., Duration::from_secs(5)) {
                tx.send(Updated);
            }
        });
    }

    fn handle_stream_loop(conn_id: Uuid, tx: &Sender<ServerEvent>, stream: TcpStream) {
        let mut reader = BufReader::new(stream);
        let mut msg = String::new();
        loop {
            match reader.read_line(&mut msg) {
                Ok(size) => {
                    if size == 0 {
                        break;
                    }
                    info!("client({}) sent msg: {}", conn_id, msg);
                    let t = parse_command(&msg.trim_matches('\0'));
                    msg.clear(); 
                    if let Ok(cmd) = t {
                        info!("client({}) command: {:?}", conn_id, cmd);
                        tx.send(ServerEvent::Command{
                            conn_id,
                            cmd
                        });
                    }
                },
                Err(e) => {
                    error!("{}", e);
                    break;
                }
            }
        }
    }

    fn send_result(&self, id: &str, res: &TaskResult) -> Result<(), Error> {
        let conn = self.redis.get_connection()?;
        let buf = serde_json::to_string(&res)?;
        Ok(conn.rpush(redis_result_channel(id), buf)?)
    }
    
    fn handle_stream(mut stream: TcpStream, tx: Sender<ServerEvent>) {
        let conn_id = Uuid::new_v4();
        tx.send(ServerEvent::Connect{
            conn_id: conn_id,
            conn: stream.try_clone().unwrap()
        });
        
        thread::spawn(move || {
            Server::handle_stream_loop(conn_id, &tx, stream);
            tx.send(ServerEvent::Close{
                conn_id
            });
        });
    }

    fn listen(&mut self) -> Receiver<ServerEvent> {
        let (tx, rx) = channel();
        self.tx = Some(tx.clone());
        self.listen_socket();
        self.listen_task().unwrap();
        self.ping_update();
        rx
    }

    fn listen_socket(&mut self) {
        let tx = self.make_tx();
        let listener = TcpListener::bind(&self.addr).unwrap();
        thread::spawn(move || {
            for t in listener.incoming() {
                if let Ok(mut stream) = t {
                    Server::handle_stream(stream, tx.clone());
                }
            }
        });
   }

   fn listen_task(&mut self) -> Result<(), Error> {
        let conn = self.redis.get_connection()?;
        let name = self.name.clone();
        let tx = self.make_tx();
        thread::spawn(move || {
            loop {
                let res: Vec<String> = match conn.blpop(redis_game_queue(&name), 0) {
                    Ok(res) => res,
                    Err(e) => { error!("{}", e); continue }
                };
                let task_request: TaskRequest = match serde_json::from_str(&res.get(1).unwrap()) {
                    Ok(task) => task,
                    Err(e) => { error!("{}", e); continue }
                };
                info!("task({}) arrived: {:?}", task_request.id, task_request.task);
                tx.send(ServerEvent::TaskRequest { task_request });
            }
        });
        Ok(())
   }
}