import {Logger,InitEvent, PlayerJoinEvent, Player, Item,Command, CommandEnum, CommandEnumOptions, CommandExecutor, CommandExecutorType, CommandParam, CommandParamDataType, CommandParamType, InternalPermission} from "../lib/index.js";


function tellExecutor(executor:CommandExecutor,msg:string){
    switch(executor.type){
        case CommandExecutorType.Player:executor.object.tell(msg);break;
        case CommandExecutorType.Console:Logger.info(msg);break;
    }
}
import {SQLDataType, SQLDataTypeEnum, SQLite3, YMLFile} from "../lib/FeaturesIndex.js"
import {data_path} from "../lib/plugin_info.js"
import * as crypto from "crypto"
const conf=new YMLFile(data_path+"/config.yml")
const items_conf=new YMLFile(data_path+"/items.yml")
items_conf.init("packs",[])
//物品：一个列表
// 每个物品还包括nbt，代表给予玩家的物品要带有什么样的nbt，暂时不做，
// 每个物品还有count，代表数量
// 物品还有一个identifier，代表这个物品
//奖励开始时间：从哪天开始发放这个奖励
//奖励截止时间：过了这个时间后就不能领取这个奖励了
//identifier：确定补偿的唯一性，修改它会导致补偿重新开始，然而原有数据不会被覆盖或删除。
//identifier允许有任何字符，虽然它与数据库的表名有关，但是插件会为identifier计算哈希值
//表名是identifer的哈希值，由于运维是不能通过哈希值反向得到identifier的表名的
//所以插件自行维护一个表，记录了identifier与哈希值的关系
//那个表不是复合主键，identifier是主键，哈希值不是，这么做主要是考虑到哈希碰撞导致的哈希值列不符合UNIQUE约束
//备注名：用于在游戏中显示的补偿项目名称，可以随意更改，不影响补偿发放
//发放至邮箱：插件内置一个邮件系统，用于领取奖励，如果不发放至邮箱，插件将持续关注玩家物品栏，在玩家物品栏有空位时立刻发放

const db=new SQLite3(data_path+"/data.db")
//记录identifier与哈希值对应关系的表
db.initTable("table_name_hash",{
    name:"identifier",
    data_type:new SQLDataType(SQLDataTypeEnum.TEXT),
    constraint:{
        primary_key:true
    }
},{
    name:"md5",
    data_type:new SQLDataType(SQLDataTypeEnum.TEXT)
})
//插件内建的玩家xuid、uuid、游戏名查询系统
db.initTable("player_info",{
    name:"uuid",
    data_type:new SQLDataType(SQLDataTypeEnum.TEXT),
    constraint:{
        primary_key:true
    }
},{
    name:"xuid",
    data_type:new SQLDataType(SQLDataTypeEnum.TEXT)
},{
    name:"name",
    data_type:new SQLDataType(SQLDataTypeEnum.TEXT)
})
//服务器启动时初始化所有补偿对应数据库中的表
try{
    for(let pack of items_conf.get("packs"))try{
        const md5=toMD5(pack.identifier)
        //将这个表的哈希值加入id和哈希对应关系的表中
        db.setRowFromPrimaryKey("table_name_hash",pack.identifier,{
            columnName:"md5",
            value:md5
        })
        //初始化这个表
        db.initTable(md5,{
            name:"uuid",
            data_type:new SQLDataType(SQLDataTypeEnum.TEXT),
            constraint:{
                primary_key:true
            }
        },{//发放日期，如果为null证明未领取，写入了这个值证明奖励已经完全领取
            name:"time_distributed",
            data_type:new SQLDataType(SQLDataTypeEnum.INTEGER)
        },{//已发放内容，是一个存储identifier列表的JSON
            name:"distributed_items",
            data_type:new SQLDataType(SQLDataTypeEnum.TEXT)
        })
        //检查物品的identifier是否有重复
        const item_identifiers:Set<string>=new Set()
        for(let item of pack.items){
            if(item.identifier===undefined){
                Logger.error("在奖励项"+pack.remark+"中，有一个类型为"+item.type+"的物品没有定义identifier！请填写该项，否则所有玩家都无法领取这个物品。")
                continue;
            }
            if(item_identifiers.has(item.identifier))Logger.error("在奖励项"+pack.remark+"中，identifier "+item.identifier+"存在重复！")
            item_identifiers.add(item.identifier)
        }
    }    
    catch(e){
        Logger.error("为一项补偿初始化数据库时遇到了问题："+e)
    }
}
catch(e){
    Logger.fatal("无法初始化数据库，错误为"+e)
}

PlayerJoinEvent.on(e=>{
    //更新玩家的身份信息
    db.setRowFromPrimaryKey("player_info",e.player.uuid,{
        columnName:"xuid",
        value:e.player.xuid
    },{
        columnName:"name",
        value:e.player.name
    })
    const packs:any[]=items_conf.get("packs")
    //遍历奖励对玩家进行发放
    for(let pack of packs){
        let {distributedItems,distributedTime}=getPlayerReciveRecord(e.player.uuid,pack.identifier)
        //已经发放过的就不发了
        if(distributedTime!=undefined)continue;
        //遍历物品列表对玩家进行发放
        for(let item of pack.items){
            //没有配置identifier，无法为当前奖励记录发放情况，所以直接发都不发
            if(item.identifier==undefined){
                Logger.error("在奖励项"+pack.remark+"中，有一个类型为"+item.type+"的物品没有定义identifier，所以刚刚玩家"+e.player.name+"并没有收到它。")
                continue;
            }
            //如果物品已经给玩家发过，就不发这个物品了
            if(distributedItems.includes(item.identifier))continue
            //todo：背包检测，如果背包没有足够的空间就不发放当前奖励，直接continue
            //if(playerPackHasCapacity(e.player,item))
            //todo：给予玩家带有nbt的物品
            e.player.giveItem(new Item(item.type,item.count==undefined?1:item.count))
            //既然已经发放，将该奖励加入已收到的奖励列表
            distributedItems.push(item.identifier)
        }
        //全部发放完毕时，检查玩家是否已经收到了当前奖励中的所有物品
        let playerRecievedAllItems=true
        for(let packItem of pack.items){
            //如果已经发放给玩家的物品中不包含当前物品，证明玩家从未成功收到过该物品，证明玩家还没有完全收到所有物品
            if(!distributedItems.includes(packItem.identifier))playerRecievedAllItems=false
        }
        //todo：提示玩家都收到了奖励的哪些
        e.player.tell("奖励"+pack.remark+"已发放至您的背包")
        //如果playerRecievedAllItems为true，证明已经收到所有物品，写入领取时间
        distributedTime=new Date()
        //将已经发放的物品直接写入该玩家领取记录
        setPlayerReciveRecord(e.player.uuid,pack.identifier,distributedItems,distributedTime)
    }
    
})

function toSHA256(content:string){
    const hash = crypto.createHash('sha256')
    hash.update(content)
    return hash.digest('hex')
}
function toSHA1(content:string){
    const hash = crypto.createHash('sha1')
    hash.update(content)
    return hash.digest('hex')
}
function toMD5(content:string){
    const hash = crypto.createHash('md5')
    hash.update(content)
    return hash.digest('hex')
}
function getTableNameFromIdentifier(identifier:string){
    return db.getRowFromPrimaryKey("table_name_hash",identifier).get("md5")
}
function getPlayerReciveRecord(uuid:string,identifier:string){
    const tableName=getTableNameFromIdentifier(identifier)
    const playerRecieveRecord=db.getRowFromPrimaryKey(tableName,uuid)
    const distributedItems:string|undefined=playerRecieveRecord.get("distributed_items");
    const rawDistributedTime:number|undefined=playerRecieveRecord.get("time_distributed")
    const distributedTime:Date|undefined=rawDistributedTime!=undefined?new Date(rawDistributedTime):undefined;
    return {distributedItems:distributedItems==undefined?[]:JSON.parse(distributedItems),distributedTime}
}
function setPlayerReciveRecord(uuid:string,identifier:string,distributed_items:string[],time_distributed:Date|undefined){
    const tableName=getTableNameFromIdentifier(identifier)
    db.setRowFromPrimaryKey(tableName,uuid,{
        columnName:"distributed_items",
        value:JSON.stringify(distributed_items)
    },{
        columnName:"time_distributed",
        value:time_distributed?.getTime()
    })
}

export const mgrcmd=new Command("newbiepack",
    [
        new CommandParam(CommandParamType.Mandatory,"reload",CommandParamDataType.Enum,new CommandEnum("reload", ["reload"]),CommandEnumOptions.Unfold),
        new CommandParam(CommandParamType.Mandatory,"log",CommandParamDataType.Enum,new CommandEnum("log", ["log"]),CommandEnumOptions.Unfold),
        new CommandParam(CommandParamType.Mandatory,"info",CommandParamDataType.Enum,new CommandEnum("info", ["conf"]),CommandEnumOptions.Unfold),
        new CommandParam(CommandParamType.Mandatory,"dev",CommandParamDataType.Enum,new CommandEnum("dev", ["dev"]),CommandEnumOptions.Unfold),
        new CommandParam(CommandParamType.Mandatory,"db",CommandParamDataType.Enum,new CommandEnum("db", ["db"]),CommandEnumOptions.Unfold),
        new CommandParam(CommandParamType.Mandatory,"unload",CommandParamDataType.Enum,new CommandEnum("unload", ["unload"]),CommandEnumOptions.Unfold),
        new CommandParam(CommandParamType.Mandatory,"load",CommandParamDataType.Enum,new CommandEnum("load", ["load"]),CommandEnumOptions.Unfold),
        new CommandParam(CommandParamType.Mandatory,"exe",CommandParamDataType.Enum,new CommandEnum("exe", ["exe"]),CommandEnumOptions.Unfold),
        new CommandParam(CommandParamType.Mandatory,"devoptions",CommandParamDataType.String),
        new CommandParam(CommandParamType.Mandatory,"dbcmd",CommandParamDataType.String)
    ],[["reload"],["log","info"],["dev","devoptions"],["db","exe","dbcmd"],["db","unload"],["db","load"]],
    result=>{
        if (result.params.get("reload")?.value == "reload") {
            if (conf.reload()) {
                tellExecutor(result.executor,"配置文件重载完成")
            } else {
                tellExecutor(result.executor,"无法重载配置文件")
            }
        }
        else if(result.params.get("dev")?.value=="dev"){
            const tableName=result.params.get("devoptions")?.value
            tellExecutor(result.executor,JSON.stringify(db.queryAllSync("select * from "+tableName),undefined,4))
        }
        else if(result.params.get("db")?.value=="db"){
            //if(result.params.get("unload")?.value=="unload")if(unloaddb())tellExecutor(result.executor,"数据库已卸载。卸载后插件大部分功能都将不可用，要想重新加载数据库，请执行/tpamgr db load")
            //if(result.params.get("load")?.value=="load")if(loaddb())tellExecutor(result.executor,"数据库加载成功")
            if(result.params.get("dbcmd")?.value){
                const cmd=result.params.get("dbcmd")?.value
                console.log(cmd)
                tellExecutor(result.executor,cmd)
                tellExecutor(result.executor,JSON.stringify(db.queryAllSync(cmd),undefined,4))
            }
        }
    },
    InternalPermission.GameMasters,[],"管理新手礼包与玩家补偿"
)