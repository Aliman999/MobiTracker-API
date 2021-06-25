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
var webSocket = null, clients=[], hourly, sql, keyType = "Main";;
var key;

const limiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 2000
});

limiter.on("failed", async (error, info) => {
  const id = info.options.id;
  console.warn(`${id} failed: ${error}`);

  if (info.retryCount < 2) {
    return 2000;
  }else{
    info.args[2].send(JSON.stringify({
      type:"response",
      data:info.args[0]+" not found.",
      message:"Error",
      status:0
    }));
    cachePlayer(info.args[0]);
  }
});

limiter.on("done", function(info){
  console.log("Returned "+info.options.id);
});

Object.size = function(obj){
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
  console.log("Internal API is Online");
  init();
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

function toEvent(message){
  var event = JSON.parse(message);
  this.emit(event.type, event.token);
}

function heartbeat(){
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
          ws.user = decoded.username;
          ws.isAlive = true;
          ws.send(JSON.stringify({
            type:"response",
            data:"Authenticated",
            message:"Success",
            status:1
          }));

          ws.on('job', function(data){
            async function query(username, key, ws){
              await queryApi(username, key).then((result) => {
                if(result.status == 0){
                  throw new Error(result.data);
                }else{
                  ws.send(JSON.stringify({
                    type:"response",
                    data:result.data,
                    message:"Success",
                    status:1
                  }));
                }
              })
            }
            console.log(ws.user+" started job for "+data);
            limiter.schedule( {id:data}, query, data, key, ws)
            .catch((error) => {
            });

          })
        }
      });
    })
});

const interval = setInterval(function (){
  wss.clients.forEach((item, i) => {
    if(item.isAlive === false){
      console.log("Terminating "+item.user);
      item.terminate();
    }else{
      item.isAlive = false;
    }
  });
}, 6000);

wss.on('close', function close(e) {
  clearInterval(interval);
});

async function init(){
  key = await getKey();
}

function getKey(i){
  return new Promise(callback =>{
    var apiKey;
    const sql = "SELECT id, apiKey, count FROM apiKeys WHERE note like '%"+keyType+"%' GROUP BY id, apiKey, count ORDER BY count desc LIMIT 1";
    con.query(sql, function (err, result, fields){
      if(err) throw err;
      apiKey = result[0].apiKey;
      var id = result[0].id;
      const sql = "UPDATE apiKeys SET count = count-1 WHERE id = "+id;
      con.query(sql, function (err, result, fields){
        if(err) throw err;
        callback(apiKey, i);
      })
    });
  })
}

const queryApi = function(username, key){
  return new Promise(callback => {
    var options = {
      hostname: 'api.starcitizen-api.com',
      port: 443,
      path: '/'+key+'/v1/live/user/'+escape(username),
      method: 'GET'
    }
    const req = https.request(options, res =>{
      var body = "";
      res.on('data', d => {
        body += d;
      })
      res.on('error', error => {
        callback({ status:0, data:error});
      })
      res.on('end', function(){
        try{
          var user = JSON.parse(body);
          if(user.data == null){
            callback({status:0, data:args+" returned null. Retrying."});
          }
        }catch(err){
          var result = "Failed to parse "+username;
          callback({ status:0, data:result });
        };
        if(user){
          if(Object.size(user.data) > 0){
            cachePlayer(user.data);
            callback({ status:1, data:user.data });
          }else{
            callback({ status:0, data:username+" not found." });
          }
        }else{
          console.log("User Not Found");
          callback({ status:0, data:username+" not found." });
        }
      })
    })
    req.on('error', (err) => {
      callback({ status:0, data:err});
    })
    req.end();
  });
}

function cachePlayer(user){
  if(typeof user === 'string'){
    const sql = "SELECT * FROM `CACHE players` WHERE username = '"+user+"'";
    con.query(sql, function (err, result, fields) {
      if(err) throw err;
      if(result.length > 0){
        const last = result.length-1;
        if(result[last].event != "Changed Name"){
          const sql = "INSERT INTO `CACHE players` (event, cID, username, bio, badge, organization, avatar) VALUES ( 'Changed Name', "+result[last].cID+", '"+result[last].username+"', ?, '"+result[last].badge+"', '"+result[last].organization+"', '"+result[last].avatar+"' );";
          con.query(sql, [result[last].bio], function (err, result, fields) {
            if(err) throw err;
          });
        }
      }
    });
  }else{
    var update = false;
    var eventUpdate = new Array();
    var check = { cID:0,
                  username:'',
                  badge: { src:'', title:'' },
                  organization: [],
                  avatar: ''
                };
    check.cID = parseInt(user.profile.id.substring(1));
    check.bio = JSON.stringify(user.profile.bio);
    if(!check.bio){
      check.bio = "";
    }
    check.username = user.profile.handle;
    check.badge.title = user.profile.badge;
    check.badge.src = user.profile.badge_image;
    check.avatar = user.profile.image;
    if(Object.size(user.affiliation) > 0){
      user.orgLength = Object.size(user.affiliation) + 1;
    }
    if(user.organization.sid){
      check.organization.push({ sid: user.organization.sid, rank: user.organization.stars });
    }else{
      check.organization.push({ sid: "N/A", rank: 0 });
    }
    for(var i = 0; i < Object.size(user.affiliation); i++){
      if(user.affiliation[i].sid){
        check.organization.push({ sid: user.affiliation[i].sid, rank: user.affiliation[i].stars });
      }else{
        check.organization.push({ sid: "N/A", rank: 0 });
      }
    }
    var sql = "";
    if(check.cID){
      sql = "SELECT cID, username, bio, badge, organization, avatar FROM `CACHE players` WHERE cID = "+user.profile.id.substring(1)+";";
    }else{
      check.cID = 0;
      sql = "SELECT cID, username, bio, badge, organization, avatar FROM `CACHE players` WHERE username = '"+user.profile.handle+"';";
    }
    con.query(sql, function (err, result, fields) {
      if(err) throw err;
      if(Object.size(result) > 0){
        var data = result[result.length-1];
        data.organization = JSON.parse(data.organization);
        data.organization = Object.values(data.organization);
        data.badge = JSON.parse(data.badge);
        for(var i = 0; i < Object.size(data); i++){
          if(i == 3){
            for(var x = 0; x < Object.size(data.organization) && x < Object.size(check.organization); x++){
              if(data.organization[x].sid != check.organization[x].sid){
                update = true;
                eventUpdate.push("Org Change");
              }else if(data.organization[x].rank != check.organization[x].rank){
                update = true;
                eventUpdate.push("Org Promotion/Demotion");
              }
            }
          }
        }
        if(data.cID !== check.cID){
          update = true;
          eventUpdate.push("Obtained ID");
        }
        if(data.username !== check.username){
          update = true;
          eventUpdate.push("Changed Name");
        }
        if(data.badge.title !== check.badge.title){
          update = true;
          eventUpdate.push("Badge Changed");
        }
        if(data.avatar !== check.avatar){
          update = true;
          eventUpdate.push("Avatar Changed");
        }
        if(data.bio !== check.bio){
          update = true;
          eventUpdate.push("Bio Changed");
        }
        function removeDupe(data){
          return data.filter((value, index) => data.indexOf(value) === index)
        }
        eventUpdate = removeDupe(eventUpdate);
      }else{
        check.bio = JSON.stringify(check.bio);
        check.badge = JSON.stringify(check.badge);
        check.organization = JSON.stringify(Object.assign({}, check.organization));
        const sql = "INSERT INTO `CACHE players` (event, cID, username, bio, badge, organization, avatar) VALUES ('First Entry', "+check.cID+", '"+check.username+"', ?, '"+check.badge+"', '"+check.organization+"', '"+check.avatar+"' );";
        con.query(sql, [check.bio], function (err, result, fields) {
          if(err) throw err;
        });
      }
      if(update){
        check.bio = JSON.stringify(check.bio);
        check.badge = JSON.stringify(check.badge);
        check.organization = JSON.stringify(Object.assign({}, check.organization));
        var eventString = eventUpdate.join(", ");
        const sql = "INSERT INTO `CACHE players` (event, cID, username, bio, badge, organization, avatar) VALUES ('"+eventString+"', "+check.cID+", '"+check.username+"', ?, '"+check.badge+"', '"+check.organization+"', '"+check.avatar+"');";
        con.query(sql, [check.bio], function (err, result, fields) {
          if(err) throw err;
        });
      }
    });
  }
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
