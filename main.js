'use strict';
const config  = require('./config');
const WebSocket = require('ws');
const Bottleneck = require('bottleneck');
const MySQLEvents = require('@rodrigogs/mysql-events');
const fs = require('fs');
const https = require('https');
const mysql = require('mysql');
require('console-stamp')(console, {
    format: ':date(mm/dd/yyyy HH:MM:ss)'
});
var jwt = require('jsonwebtoken');
const server = https.createServer({
  cert: fs.readFileSync('/etc/nginx/.ssl/ssl-bundle.crt'),
  key: fs.readFileSync('/etc/nginx/.ssl/mobitracker_co.key'),
});
const wss = new WebSocket.Server({ server, clientTracking:true });
var webSocket = null;
var clients=[];

const limiter = new Bottleneck({
  maxConcurrent: 3,
});

limiter.on("executing", function(info){
  //console.log(limiter.jobs("EXECUTING").join(", ")+" executing");
})

limiter.on("done", function(info){
  console.log("KEY ID:"+info.options.id+" updated");
})

const con = mysql.createPool({
  host:config.MysqlHost,
  user:config.MysqlUsername,
  password:config.MysqlPassword,
  database:config.MysqlDatabase,
  multipleStatements:true
});

con.getConnection(function(err, connection) {
  if (err) throw err;
});

if(server.listen(2599)){
  console.log("Key Maintenance is Online");
}

var trueLog = console.log;
console.log = function(msg) {
  const date = new Date();
  const day = ("0" + date.getDate()).slice(-2);
  const month = ("0" + (date.getMonth() + 1)).slice(-2);
  const year = date.getFullYear();
  fs.appendFile('/home/ubuntu/logs/keymain.log', "["+month+"/"+day+"/"+year+" "+date.toLocaleTimeString('en-US')+"]"+" - "+msg+'\n', function(err) { if(err) {
      return trueLog(err);
    }
  });
  trueLog(msg);
}

var logSave = console.save;
console.save = function(msg) {
  const date = new Date();
  const day = ("0" + date.getDate()).slice(-2);
  const month = ("0" + (date.getMonth() + 1)).slice(-2);
  const year = date.getFullYear();
  fs.appendFile('/home/ubuntu/logs/keymain.log', "["+month+"/"+day+"/"+year+" "+date.toLocaleTimeString('en-US')+"]"+" - "+msg+'\n', function(err) { if(err) {
      return trueLog(err);
    }
  });
}

function toEvent (message) {
  var event = JSON.parse(message);
  this.emit(event.type, event.token);
}

function heartbeat() {
  console.log("test");
  this.isAlive = true;
}

wss.on('connection', function(ws){
  ws.on('message', toEvent)
    .on('ping', heartbeat)
    .on('auth', function (data){
      jwt.verify(data, config.Secret, { algorithm: 'HS265' }, function(err, decoded){
        if(err){
          ws.terminate();
        }else{
          ws.user = decoded.user;
          ws.isAlive = true;
        }
      });
    })
    .on('job', function(data){
    })
});

const interval = setInterval(function (){
  clients.forEach((item, i) => {
    if(item.client.isAlive === false){
      item.client.terminate(disconnect(item.user, item.client));
    }else{
      item.client.isAlive = false;
    }
  });
}, 6000);

wss.on('close', function close(e) {
  clearInterval(interval);
});

//Key Management
async function keys(){
  var result = await getKeys();

  async function pushKey(key){
    await update(key)
    .then((result)=>{
      console.log(result);
      if(result.status == 0){
        throw new Error();
      }else{
        //var sql = "UPDATE apiKeys SET count = ";
      }
    })
  };
  for(var i = 0; i < result.length; i++){
    limiter.schedule({ id:result[i].id }, pushKey, result[i].apiKey)
    .catch((error) => {
    })
  }
}
keys();

function getKeys(){
  return new Promise(callback =>{
    var sql = "SELECT * FROM apiKeys";
    con.query(sql, function (err, result, fields) {
      if(err) throw err;
      callback(result);
    });
  })
}


function update(key){
  return new Promise(promiseSearch =>{
    var embed;
    var options = {
      hostname: 'api.starcitizen-api.com',
      port: 443,
      path: '/'+key+'/v1/me',
      method: 'GET'
    }
    console.log(options);
    const req = https.request(options, res =>{
      var body = "";
      res.on('data', d => {
        body += d;
      })
      res.on('error', error => {
        promiseSearch({status:0})
      })
      res.on('end', function(){
        try{
          var user = JSON.parse(body);
          if(user.data == null){
            promiseSearch({status:0});
          }else{
            if(Object.size(user.data) > 0){
              promiseSearch({ status:1});
            }else{
              promiseSearch({ status:0 });
            }
          }
        }catch(err){
          promiseSearch({ status:0 });
        };
      })
    })
    req.end()
  });
}

const program = async () => {
  const instance = new MySQLEvents(con, {
    startAtEnd: true,
    serverId:3,
    excludedSchemas: {
      mysql: true,
    },
  });
  await instance.start();

  instance.addTrigger({
    name: 'Alert',
    expression: '*',
    statement: MySQLEvents.STATEMENTS.ALL,
    onEvent: (event) => {
    },
  });
  instance.on(MySQLEvents.EVENTS.CONNECTION_ERROR, console.error);
  instance.on(MySQLEvents.EVENTS.ZONGJI_ERROR, console.error);
};
program().then(() => console.log('Waiting for database events...')).catch(console.error);




//INNER CLIENT TESTING

function socket(){
  var payload = jwt.sign({ user:"bot" }, config.Secret);
  var message = null;
  webSocket = new WebSocket("wss://mobitracker.co:2599");
  webSocket.onopen = function(){
    message = {
      type:"auth",
      token:payload
    };
    webSocket.send(JSON.stringify(message));
    heartbeat();
  }
  webSocket.onclose = function(){
    socket();
  };

  function heartbeat() {
    if (!webSocket) return;
    if (webSocket.readyState !== 1) return;
    webSocket.send(JSON.stringify({type:"ping"}));
    setTimeout(heartbeat, 3000);
  }
}


socket();
