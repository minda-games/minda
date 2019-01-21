import { MindaAdmin, MindaClient, MindaCredit, MindaRoom } from "./index"
import { reqPost } from "./minda/mdrequest"

async function run() {
    /*
    const client = new MindaClient("black")
    await client.createRoom({
        name: "hello",
        black:-1,
        white:-1,
        king:-1,
        rule: "",
    })
    */
    const aClient = new MindaAdmin("WU7htx_4_helo4FO3Im44pU=")
    await aClient.init()
    const listU = await aClient.listUsers()
    console.log(listU)
    console.log(await aClient.listGameServers())
    for (let i = 0; i < 30; i += 1) {
        try {
            console.log(await aClient.getTokenOfUser(i))
        } catch {
            
        }
    }
    return
    const mkToken = async (name:string) => 
        aClient.createUser(name, false).then(
            (v) => aClient.getTokenOfUser(v))
    const black = new MindaClient(await mkToken("dBlack"))
    await black.init()
    const white = new MindaClient(await mkToken("dWhite"))
    await white.init()
    const blackG = await black.createRoom("맞짱1")
    const whiteG = await white.joinRoom(blackG)
    blackG.sendChat("Black Ready")
    whiteG.sendChat("White Ready")
    await blackG.setBlack(black.me)
    await blackG.setWhite(white.me)
    blackG.startGame()
}

run()