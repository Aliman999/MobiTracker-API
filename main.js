'use strict';
const config  = require('./config');
const WebSocket = require('ws');
const Bottleneck = require('bottleneck');
const MySQLEvents = require('@rodrigogs/mysql-events');
const fs = require('fs');
const https = require('https');
const countdown = require('countdown');
const mysql = require('mysql');
const log = require('single-line-log').stdout;
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
var thirty = Date.now()+1800000;

const limiter = new Bottleneck({
  maxConcurrent: 3,
});

limiter.on("done", function(info){
  if(info.options.id == info.args[1]){
    console.log("Finished updating "+info.args[1]+" keys.");
    thirty += 1800000;
    timeToJob.start();
  }
})

limiter.on("failed", async (error, jobInfo) => {
  if(jobInfo.retryCount < 10){
    console.log("KEY ID: "+jobInfo.options.id+" failed. Retrying.");
    return 1000;
  }
});

function Timer(fn, t) {
    var timerObj = setInterval(fn, t);

    this.stop = function() {
        if (timerObj) {
            clearInterval(timerObj);
            timerObj = null;
            log.clear();
            console.log("");
        }
        return this;
    }
    this.start = function() {
      if (!timerObj) {
          this.stop();
          timerObj = setInterval(fn, t);
      }
      return this;
    }
    this.reset = function(newT = t) {
        t = newT;
        return this.stop().start();
    }
}

function calcTime(){
  const timeLeft = countdown(Date.now(), thirty);
  log("Running job in "+timeLeft.hours+":"+timeLeft.minutes+":"+timeLeft.seconds);
}

const timeToJob = new Timer(calcTime, 500);

Object.size = function(obj) {
  var size = 0, key;
  for (key in obj) {
      if (obj.hasOwnProperty(key)) size++;
  }
  return size;
};

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
  timeToJob.start();
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
          clients.push(ws);
        }
      });
    })
    .on('job', function(data){
    })
});

const interval = setInterval(function (){
  clients.forEach((item, i) => {
    if(item.isAlive === false){
      item.terminate();
    }else{
      item.isAlive = false;
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
      if(result.status == 0){
        throw new Error();
      }else{
        var sql = "UPDATE apiKeys SET count = "+result.data.value+" WHERE apiKey = '"+result.data.key+"'";
        con.query(sql, function (err, result, fields) {
          if(err) throw err;
        });
      }
    })
  };
  for(var i = 0; i < result.length; i++){
    limiter.schedule({ id:result[i].id }, pushKey, result[i].apiKey, result.length)
    .catch((error) => {
    })
  }
}

setInterval(()=>{
  keys();
  console.log("");
  timeToJob.stop();
}, 1800000)

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
              promiseSearch({ status:1, data:{ key:user.data.user_key, value:user.data.value } });
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
