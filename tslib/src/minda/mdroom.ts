import { Socket } from "net"
import { EventDispatcher, SignalDispatcher, SimpleEventDispatcher } from "strongly-typed-events"
import { Immute } from "../types/deepreadonly"
import { Serializable, SerializeObject } from "../types/serializable"
import { WebpackTimer } from "../webpacktimer"
import { ChatInfo, ConfInfo, ConnectInfo, EnterInfo,
    ErrorInfo, LeaveInfo, MdCommands, MdEvents,
    MdEventTypes, StartInfo } from "./mdevents"
import { MSGrid } from "./structure/msgrid"
import { MSRoom, MSRoomConf, MSRoomServer } from "./structure/msroom"
import { MSUser } from "./structure/msuser"

/**
 * 민다룸 백앤드 (방목록 동기화)
 */
class MindaRoomBase implements MSRoom {
    /* MSRoom implements */
    public id:string
    public created_at:number
    public conf:MSRoomConf
    public users:number[] = []
    public ingame:boolean
    /* MSRoom access helper */
    /**
     * 검은 돌의 유저ID
     */
    public get black() {
        return this.conf.black
    }
    /**
     * 하얀 돌의 유저ID
     */
    public get white() {
        return this.conf.white
    }
    /**
     * 방의 관리자
     */
    public get owner() {
        return this.conf.king
    }
    /**
     * 방의 이름
     */
    public get name() {
        return this.conf.name
    }
    /* Value implements */
    /**
     * 채팅의 메시지들 입니다.
     */
    public messages:string[] = []
    /**
     * @todo 이차원 배열이라고 하는데 난 몰라
     */
    public board:string[][] = []
    /**
     * 누구의 턴인가
     */
    public turn:"black" | "white"
    /* Public events implements */
    /**
     * 방에 접속을 성공했을때 발생합니다.
     */
    public onConnect = new SimpleEventDispatcher<MSRoom>()
    /**
     * 방에서 누군가가 채팅을 했을 때 발생합니다.
     */
    public onChat = new MindaEventDispatcher<ChatInfo>()
    /**
     * 방설정 값이 변경되었을 때 발생합니다.
     * `conf`는 새로운 방설정 값을 의미합니다.
     */
    public onConf = new SimpleEventDispatcher<MSRoomConf>()
    /**
     * 게임이 시작됐거나 이미 시작된 상태에서
     * 방에 들어왔을때 발생합니다.
     */
    public onStart = new MindaEventDispatcher<StartInfo>()
    /**
     * 방에 누군가 들어왔을 때 발생합니다.
     */
    public onEnter = new MindaEventDispatcher<EnterInfo>()
    /**
     * 유저가 게임서버를 뿅 나왔을때
     * 발생합니다.
     */
    public onLeave = new MindaEventDispatcher<LeaveInfo>()
    /**
     * 보낸 명령에 문제가 있을 시에 발생합니다.
     */
    public onMindaError = new SimpleEventDispatcher<string>()
    /* Unique implements */
    /**
     * 현재 소켓서버랑 연결됐는지 여부
     */
    public connected = false
    /* protected events */
    protected onEvents = new EventDispatcher<MdEvents, unknown>()
    protected onSocketOpen = new SignalDispatcher()
    protected onSocketDrain = new SignalDispatcher()
    protected onSocketError = new SimpleEventDispatcher<Error>()
    protected onSocketData = new SimpleEventDispatcher<ArrayBuffer>()
    protected onSocketClose = new SignalDispatcher()
    /**
     * [소-켓](https://www.npmjs.com/package/emailjs-tcp-socket)
     */
    protected socket:Socket
    /**
     * 웹소켓 캐시
     */
    protected cache:string
    public constructor(serverInfo:MSRoomServer) {
        const [ip, port] = serverInfo.addr.split(":")
        this.socket = new Socket()
        this.socket.on("connect", () => this.onSocketOpen.dispatch())
        this.socket.on("drain", () => this.onSocketDrain.dispatch())
        this.socket.on("error", (error:Error) => this.onSocketError.dispatch(error))
        this.socket.on("data", (arraybuffer:ArrayBuffer) => this.onSocketData.dispatch(arraybuffer))
        this.socket.on("close", () => this.onSocketClose.dispatch())
        // debug
        this.onSocketData.sub(this.onRawPacket.bind(this))
        this.socket.connect(Number.parseInt(port), ip, () => {
            this.connected = true
            this.cache = ""
            this.send("connect", {
                invite: serverInfo.invite,
            })
        })
    }
    /**
     * 소켓 강제 종료
     */
    public close() {
        this.socket.destroy()
    }
    /**
     * 웹소켓 패킷을 관리합니다.
     * @param type 이벤트 타입
     * @param event 이벤트 파라메터
     */
    protected async handleRoomPacket(type:MdEvents, event:unknown) {
        switch (type) {
            case MdEvents.chat: {
                const chatE = event as ChatInfo
                this.messages.push(chatE.content)
                this.onChat.dispatch(chatE)
            } break
            case MdEvents.conf: {
                const confE = event as ConfInfo
                this.conf = confE.conf
                this.onConf.dispatch(confE.conf)
            } break
            case MdEvents.connect: {
                const connect = event as ConnectInfo
                const room = connect.room
                this.id = room.id
                this.created_at = room.created_at
                this.conf = room.conf
                this.users = room.users
                this.ingame = room.ingame
                this.onConnect.dispatch({
                    ...connect.room
                })
            } break
            case MdEvents.enter: {
                const enter = event as EnterInfo
                const users = [...this.users]
                if (users.find((v) => v === enter.user) == null) {
                    users.push(enter.user)
                    this.users = users
                }
                this.onEnter.dispatch(enter)
            } break
            case MdEvents.error: {
                const errorE = event as ErrorInfo
                this.onMindaError.dispatch(errorE.msg)
                console.error(`MindaError: ${errorE.msg}`)
            } break
            case MdEvents.leave: {
                const leaveE = event as LeaveInfo
                const users = [...this.users]
                const index = users.findIndex((v) => v === leaveE.user)
                if (index >= 0) {
                    users.splice(index, 1)
                    this.users = users
                }
                this.onLeave.dispatch(leaveE)
            } break
            case MdEvents.move: {
                // @TODO 언젠가 합시다
            } break
            case MdEvents.start: {
                const startE = event as StartInfo
                this.conf.black = startE.black
                this.conf.white = startE.white
                this.turn = startE.turn
                this.board = startE.board
                this.onStart.dispatch(startE)
            } break
            default: {
                console.log(type + " / " + JSON.stringify(event, null, 2))
                break
            }
        }
    }
    /**
     * 소켓에게 명령을 보냅니다
     * @param type 명령 타입
     * @param param 명령 파라메터
     */
    protected async send<T extends keyof MdCommands>(type:T, param?:MdCommands[T]) {
        if (param == null) {
            param = {}
        }
        return this.sendRaw(type, param)
    }
    /**
     * 소켓에게 깡 type을 보냅니다.
     * @param type 명령 타입
     * @param param 명령 파라메터
     */
    protected async sendRaw(type:string, param:object = {}) {
        if (!this.connected) {
            return
        }
        const json = JSON.stringify({
            "type": type,
            ...param,
        })
        this.socket.write(json + "\n")
    }
    /**
     * 소켓에 데이터가 왔을 때 핸들링합니다.
     * Raw패킷만 핸들링합니다.
     * @param buf 버퍼[]
     */
    private async onRawPacket(buf:ArrayBuffer) {
        const raw = Buffer.from(buf)
        const data = raw.toString("utf8")
        this.cache += data
        while (this.cache.indexOf("\n") >= 0) {
            const msg = this.cache.substring(0, this.cache.indexOf("\n"))
            this.cache = this.cache.substring(this.cache.indexOf("\n") + 1)
            // process msg now.
            const event:MdEventTypes = JSON.parse(msg)
            const type = event.type
            this.onEvents.dispatch(type, event)
        }
    }
}
/**
 * 민다의 게임하는 방을 관리합니다.
 * 
 * 모든 명령어는 불가능할시 false, 가능할시 true를 반환합니다.
 */
export class MindaRoom extends MindaRoomBase {
    protected readonly me:MSUser
    public constructor(serverInfo:MSRoomServer,myid:MSUser) {
        super(serverInfo)
        this.me = {
            ...myid
        }
    }
    /**
     * 채팅을 보냅니다.
     * @param chat 글자
     */
    public sendChat(msg:string) {
        if (!this.connected) {
            return false
        }
        this.send("chat", {
            content: msg,
        })
        return true
    }
    /**
     * `방이름`을 바꿉니다.
     * @param name 바꿀 방이름
     */
    public setName(name:string) {
        return this.setConfig({
            name,
        })
    }
    /**
     * `검은팀`을 바꿉니다.
     * @param user 검은팀으로 갈 유저이름
     */
    public setBlack(user:number | MSUser) {
        return this.setConfig({
            black: this.getIdOfUser(user),
        })
    }
    /**
     * `하얀팀`을 바꿉니다.
     * @param user 하얀팀으로 갈 유저이름
     */
    public setWhite(user:number | MSUser) {
        return this.setConfig({
            white: this.getIdOfUser(user),
        })
    }
    /**
     * `방장`을 바꿉니다.
     * 
     * **방장을 잃습니다**
     * @param user 방장 위임할 유저이름 
     */
    public async setOwner(user:number | MSUser) {
        if (this.isOwner(this.me) &&
            this.getIdOfUser(user) === this.me.id) {
            // no need to handle
            return true
        }
        return this.setConfig({
            king: this.getIdOfUser(user),
        })
    }
    /**
     * `방설정`을 바꿉니다.
     * @param cfg 방설정
     */
    public async setConfig(cfg:Partial<MSRoomConf>) {
        if (!this.connected || !this.isOwner(this.me)) {
            return false
        }
        if (this.ingame) {
            return false
        }
        const modified = {
            ...this.conf,
            ...cfg,
        }
        this.send("conf", {
            conf: modified,
        })
        return new Promise<boolean>((res, rej) => {
            let revoke:() => void
            WebpackTimer.setTimeout(() => {
                revoke()
                rej("Timeout")
            }, 1000)
            revoke = this.onConf.sub((conf) => {
                let diff = false
                for (const key of Object.keys(conf)) {
                    if (conf.hasOwnProperty(key)) {
                        if (conf[key] !== modified[key]) {
                            diff = true
                            break
                        }
                    }
                }
                if (!diff) {
                    res(true)
                }
            })
        })
        return true
    }
    /**
     * 게임을 시작합니다.
     * 
     * `방설정`이 제대로 됐는지 확인해주세요.
     */
    public startGame() {
        if (!this.connected || !this.isOwner(this.me)) {
            return false
        }
        if (this.black >= 0 && this.white >= 0) {
            this.send("start")
            return true
        }
        return false
    }
    /**
     * **빠른 서렌**칩니다.
     * `정치`하는데 편합니다.
     */
    public giveUp() {
        if (!this.connected || !this.ingame) {
            return false
        }
        if (this.white === this.me.id || this.black === this.me.id) {
            this.send("gg")
            return true
        }
        return false
    }
    /**
     * 방장인지 확인합니다.
     * @param id 유-저
     */
    protected isOwner(id:number | MSUser) {
        return this.owner === this.getIdOfUser(id)
    }
    protected getIdOfUser(id:number | MSUser) {
        if (typeof id === "object") {
            id = id.id
        }
        return id
    }
}
class MindaEventDispatcher<T> extends SimpleEventDispatcher<Exclude<T, "type">> {}