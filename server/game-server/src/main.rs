#![feature(try_trait)]
extern crate redis;
extern crate uuid;
extern crate rand;
extern crate serde;
extern crate ticker;
extern crate serde_json;
#[macro_use]
extern crate serde_derive;
#[macro_use]
extern crate quick_error;
#[macro_use]
mod tool;
extern crate chrono;
extern crate simplelog;
extern crate clap;

use clap::{Arg, App};
use simplelog::*;

mod error;
mod model;
mod game;
mod server;

use server::{Server};

fn main() {
    let matches = App::new("game-server")
        .arg(Arg::with_name("NAME")
                 .required(true)
                 .takes_value(true)
                 .index(1)
                 .help("unique name of server"))
        .arg(Arg::with_name("ADDR")
                 .required(true)
                 .takes_value(true)
                 .index(2)
                 .help("address of server"))
        .arg(Arg::with_name("REAL_ADDR")
                 .required(true)
                 .takes_value(true)
                 .index(3)
                 .help("real address of server"))
        .arg(Arg::with_name("REDIS")
                 .default_value("redis://127.0.0.1/")
                 .takes_value(true)
                 .index(4)
                 .help("address of redis server"))
        .get_matches();
    let name = matches.value_of("NAME").unwrap();
    let addr = matches.value_of("ADDR").unwrap();
    let real_addr = matches.value_of("REAL_ADDR").unwrap();
    let redis = matches.value_of("REDIS").unwrap();
    let server = Server::new(addr, name, real_addr, redis);
    server.serve();
}

