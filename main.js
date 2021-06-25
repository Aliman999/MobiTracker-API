'use strict';
const config  = require('./config');
const WebSocket = require('ws');
const Bottleneck = require('bottleneck');
const MySQLEvents = require('@rodrigogs/mysql-events');
const fs = require('fs');
const https = require('https');
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
var webSocket = null, clients=[], hourly, sql;

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

const limiter = new Bottleneck({
  maxConcurrent: 1
});

limiter.on("done", function(info){
  console.log(info);
})

limiter.on("failed", async (error, jobInfo) => {
  if(jobInfo.retryCount < 2){
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
        persist(3).then((param) => {
          hourly = parseInt(param);
          if (!timerObj) {
              this.stop();
              timerObj = setInterval(fn, t);
          }
          return this;
        });
    }
    this.reset = function(newT = t) {
        t = newT;
        return this.stop().start();
    }
}


if(server.listen(2599)){
  console.log("MobiTracker API is Online");
}

var trueLog = console.log;
console.log = function(msg){
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
console.save = function(msg){
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
          console.log(wss);
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
