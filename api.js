'use strict';
const config  = require('./config');
const WebSocket = require('ws');
const Bottleneck = require('bottleneck');
const MySQLEvents = require('@rodrigogs/mysql-events');
const fs = require('fs');
const https = require('https');
const mysql = require('mysql');
const Diff = require('diff');
const log = require('single-line-log').stdout;
require('colors');
require('console-stamp')(console, {
    format: ':date(mm/dd/yyyy HH:MM:ss)'
});
var jwt = require('jsonwebtoken');
const server = https.createServer({
  cert: fs.readFileSync('/etc/letsencrypt/live/ws.mobitracker.co/fullchain.pem'),
  key: fs.readFileSync('/etc/letsencrypt/live/ws.mobitracker.co/privkey.pem'),
});
const wss = new WebSocket.Server({ server, clientTracking:true });
var webSocket = null, clients=[], hourly, sql, keyType = "Main";;
var key;
var SHA256 = require("crypto-js/sha256");

const Enmap = require("enmap");

// non-cached, auto-fetch enmap: 
const adminPanel = new Enmap({
  name: "adminPanel",
  autoFetch: true,
  fetchAll: true
});

const orgLimiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 2000
});

orgLimiter.on("failed", async (error, info) => {
  const id = info.options.id;
  console.warn(`${id} failed: ${error}`);

  if (info.retryCount < 3) {
    return 2000;
  }else{
    info.args[1].send(JSON.stringify({
      type:"response",
      data:info.args[0]+" not found.",
      message:"Error",
      status:0
    }));
    cachePlayer(info.args[0]);
  }
});

orgLimiter.on("done", function(info){
  console.log("Returned data for "+info.options.id);
});

const queryUser = new Bottleneck({
  maxConcurrent: 1,
  minTime: 2000
});

queryUser.on("failed", async (error, info) => {
  const id = info.options.id;
  console.warn(`${id} failed: ${error}`);

  if (info.retryCount < 2) {
    return 2000;
  }else{
    info.args[1].send(JSON.stringify({
      type:"response",
      data:info.args[0]+" not found.",
      message:"Error",
      status:0
    }));
  }
});

queryUser.on("done", function(info){
  console.log("Returned data for "+info.options.id);
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
  premium.getID();
});

if(server.listen(2599)){
  console.log("Internal API is Online");
  init();
}

function toEvent(message){
  var event = JSON.parse(message);
  event = Object.values(event);
  this.emit(...event);
}

function heartbeat(){
  this.isAlive = true;
}

var apiKeys = {
  getKey:function(orgSID){
    return new Promise(callback =>{
      orgSID = orgSID.toLowerCase();
      callback(fs.readFileSync('/home/ubuntu/mtapi/keys/'+orgSID+'/api.secret'));
    })
  }
};

var api = {
  queryUser:async function(username, ws){
    await queryApi(username).then((result) => {
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
  },
  priority: async function(user){
    return new Promise(callback => {
      const sql = "SELECT value FROM priority WHERE cID = '"+user+"';";
      con.query(sql, function (err, result, fields) {
        if (err) throw err;
        if(result[0]){
          callback(result[0].value);
        }else{
          callback(9);
        }
      });
    })
  },
  history:{
    user:function(type = 'username', input = null, ws){
      if(input === 0 || input === null || type === null || type === 0){
        ws.send(JSON.stringify({
          type: "response",
          data: null,
          message: "Input rejected",
          status: 0
        }));
      }else{
        ws.send(JSON.stringify({
          type: "progress",
          data: null,
          message: "Processing your Request",
          status: 1
        }));
      }
      if(type != "username" && type != "cID"){
        ws.send(JSON.stringify({
          type: "response",
          data: null,
          message: "Type rejected",
          status: 0
        }));
      }
      return new Promise(callback =>{
        const sql = "SELECT * FROM `CACHE players` WHERE "+type+" = '"+input+"'";
        con.query(sql, function (err, result, fields){
          if(err) throw err;
          var saved = Array.from(result);
          result.forEach((item, i) => {
            delete item.id;
            //d.toLocaleString("en-US", { month: "long", day: "2-digit", year: "numeric" })
            var d = new Date(item.timestamp);
            var dayStamp = d.toLocaleString("en-US", { day: "2-digit" });
            var monthStamp = d.toLocaleString("en-US", { month: "short" });
            var dateStamp = d.toLocaleString("en-US", { month: "long", day: "2-digit", year: "numeric" });
            var timeStamp = d.toLocaleString("en-US", { hour: "2-digit", minute: "2-digit" });
            var direction = i % 2;
            var events = "";
            if(item.event === "First Entry"){
              events = item.username+" discovered. Citizen ID:"+item.cID;
              result[i] = { title: item.event, description: events, day: dayStamp, month: monthStamp, date: dateStamp, time: timeStamp, direction: direction, extra: null, actions:[]};
            }else if(item.event === "Changed Name"){
              if(type == "cID"){
                events = saved[i - 1].username + " changed their name to " + item.username + ".";
                result[i] = { title: item.event, description: events, day: dayStamp, month: monthStamp, date: dateStamp, time: timeStamp, direction: direction, extra: null, actions:[] };
              }else{
                events = item.username+" changed their username.";
                result[i] = { title: item.event, description: events, day: dayStamp, month: monthStamp, date: dateStamp, time: timeStamp, direction: direction, extra: null, actions:[] };
              }
            }else if(item.event === "Org Change"){
              var org1 = [];
              var org2 = [];

              for (const [key, value] of Object.entries(JSON.parse(item.organization))) {
                org1.push({sid: value.sid, rank:value.rank});
              }
              for (const [key, value] of Object.entries(JSON.parse(saved[i - 1].organization))) {
                org2.push({ sid: value.sid, rank: value.rank });
              }
              var left = org2.filter(comparer(org1));

              var joined = org1.filter(comparer(org2));
              if(left.length){
                events = " left ";
                events += left.map(e => e.sid + " [" + e.rank + "]").join(",");
              }
              if(left.length && joined.length){
                events += " and joined ";
                events += joined.map(e => e.sid + " [" + e.rank + "]").join(",");
              }else{
                events = " joined ";
                events += joined.map(e => e.sid + " [" + e.rank + "]").join(",");
              }

              result[i] = { title: item.event, description: item.username + events, day: dayStamp, month: monthStamp, date: dateStamp, time: timeStamp, direction: direction, extra: null, actions:[] };
            }else if(item.event === "Org Promotion/Demotion"){
              var org1 = [];
              var org2 = [];

              for (const [key, value] of Object.entries(JSON.parse(item.organization))) {
                org1.push({ sid: value.sid, rank: value.rank });
              }

              for (const [key, value] of Object.entries(JSON.parse(saved[i - 1].organization))) {
                org2.push({ sid: value.sid, rank: value.rank });
              }

              var demotion = org2.filter(comparer(org1));
              var promotion = org1.filter(comparer(org2));
              if (demotion.length) {
                events = " promoted in ";
                events += demotion.map(e => e.sid + " [" + e.rank + "]").join(",");
              }
              if (demotion.length && promotion.length) {
                events += " to ";
                events += promotion.map(e => " [" + e.rank + "]").join(",");
              }

              result[i] = { title: item.event, description: item.username + events, day: dayStamp, month: monthStamp, date: dateStamp, time: timeStamp, direction: direction, extra: null, actions:[] };
            }else if(item.event === "Badge Changed"){
              events = item.username+" changed their badge from "+saved[i].badge.title+" to "+item.badge.title+".";
              result[i] = { title: item.event, description: events, day: dayStamp, month: monthStamp, date: dateStamp, time: timeStamp, direction: direction, extra: null, actions:[] };
            }else if(item.event === "Avatar Changed"){
              events = item.username+" changed their avatar.";
              result[i] = { title: item.event, description: events, day: dayStamp, month: monthStamp, date: dateStamp, time: timeStamp, direction: direction, extra: { old: saved[i - 1].avatar, new: item.avatar }, actions: [{ text: "View Bio", href: "" }]};
            }else if(item.event === "Bio Changed"){
              events = item.username + " changed their bio.";
              var tempOldBio = '';
              try{
                tempOldBio = JSON.parse(JSON.parse(saved[i - 1].bio));
              }catch(e){
                //cannot parse empty string;
              }
              var tempNewBio = JSON.parse(JSON.parse(item.bio));
              var changes = Diff.diffTrimmedLines(tempOldBio, tempNewBio);
              var changesOutput = '';
              changes.forEach((part) => {
                // green for additions, red for deletions
                // grey for common parts
                const color = part.added ? 'new' :
                  part.removed ? 'old' : 'match';
                changesOutput += "<span class='"+color+"'>"+part.value+"</span><br>";
              });
              result[i] = { title: item.event, description: events, day: dayStamp, month: monthStamp, date: dateStamp, time: timeStamp, direction: direction, extra: changesOutput, actions: [{ text: "View Bio", href: "" }]};
            }
          });
          callback(result);
        });
      })
    },
    org:function(type = 'sid', input = null, ws){
      ws.send(JSON.stringify({
        type:"progress",
        data:null,
        message:"Processing your Request",
        status:1
      }));
      return new Promise(callback =>{
        const sql = "SELECT * FROM `CACHE organizations` WHERE "+type+" = '"+input+"'";
        con.query(sql, function (err, result, fields){
          if(err) throw err;
          console.log(result);
          result.forEach((item, i) => {
            delete item.id;
          });
          callback(result);
        });
      })
    }
  },
  xp:function(rep){
    rep = parseInt(rep);
    if(rep < 0){
      if(rep < -5){
        return "Dangerous";
      }else if (rep < 0) {
        return "Sketchy";
      }
    }else{
      if(rep == 0){
        return "Newbie";
      }else if (rep <= 30) {
        return "Experienced";
      }else if (rep <= 100) {
        return "Reliable";
      }
    }
  }
};

var premium = {
  ids:[],
  getID:function(orgSID){
    return new Promise(callback =>{
      const sql = "SELECT * FROM premium";
      con.query(sql, function (err, result, fields){
        result.forEach((item, i) => {
          premium.ids.push(item.username);
        });
        console.log("Loaded premium users "+premium.ids.join(", "));
        callback();
      });
    })
  },
  query:function(id, func, ...args){
    console.log(args);
    this.group.key(id).schedule(func, args)
  },
  group:new Bottleneck.Group({
    maxConcurrent: 2,
    minTime: 2000
  })
};

premium.group.on('created', function(limiter, key){
  console.log("A new limiter was created for: " + key)

  limiter.on("received", (info) => {
    //console.log(info);
  })

  limiter.on("error", (err) => {
    // Handle errors here
  })
})

var admin = {
  addPremium:function(){
  }
};

var scanner;

wss.on('connection', function(ws){
  ws.on('message', toEvent)
    .on('ping', heartbeat)
    .on('internal', function (data){
      jwt.verify(data, config.Secret, { algorithm: 'HS265' }, function(err, decoded){
        if(err){
          console.log(err);
          ws.terminate();
        }else{
          ws.user = decoded.username;
          ws.isAlive = true;
          ws.priority = api.priority(ws.user);
          ws.send(JSON.stringify({
            type:"authentication",
            data:null,
            message:"Authenticated",
            status:1
          }));

          ws.on('job', function (data) {
            console.log(ws.user+" searched for "+data);
            queryUser.schedule( {id:data}, api.queryUser, data, ws)
            .catch((error) => {
            });
          })

          ws.on('history', function (data) {
            console.log(data);
            console.log(ws.user + " requested history on " + data.input);
            queryUser.schedule({ priority:ws.priority, id: data.input }, api.history[data.type], data.datatype, data.input, ws)
            .then((result) => {
              ws.send(JSON.stringify({
                type: "response",
                data: result,
                message: "Success",
                status: 1
              }));
            })
            .catch((error) => {
            });
          })
        }
      });
    })
    .on('auth', function(data){
      apiKeys.getKey(data.org)
      .then((secret) => {
        jwt.verify(data.jwt, secret, { algorithm: 'HS256' }, function(err, decoded){
          if(err){
            ws.send(JSON.stringify({
              type:"authentication",
              data:null,
              message:"Auth Failed "+err.message,
              status:1
            }));
            ws.terminate();
          }else{
            ws.org = data.org;
            ws.isAlive = true;
            ws.premium = premium.ids.includes(ws.org);
            console.log(ws.premium);
            ws.send(JSON.stringify({
              type:"authentication",
              data:null,
              message:"Authenticated",
              status:1
            }));
            if(ws.premium){
              ws.on('user', function(data){
                console.log(data);
                premium.group.key(this.org.toUpperCase()).schedule({priority:data.priority}, api.queryUser, data, ws)
                .catch((error) => {
                })
                .then((result)=>{
                  ws.send(JSON.stringify({
                    type:"response",
                    data:result,
                    message:"Success",
                    status:1
                  }));
                })
              });
              ws.on('history', function(data){
                if(!data.priority) data.priority = 9;
                premium.group.key(this.org.toUpperCase()).schedule({priority:data.priority}, api.history[data.type], data.datatype, data.input, ws)
                .catch((error)=>{

                })
                .then((result)=>{
                  ws.send(JSON.stringify({
                    type:"response",
                    data:result,
                    message:"Success",
                    status:1
                  }));
                })
              })
            }else{
              ws.on('user', function(data){
                console.log(this.org);
                queryUser.schedule( {id:data+" | from "+this.org.toUpperCase()}, api.queryUser, data, ws)
                .catch((error) => {
                });
              })
              ws.on('history', function(){
                console.log(data);
                queryUser.schedule( {id:data+" | from "+this.org.toUpperCase()}, api.queryUser, data, ws)
                .catch((error) => {
                });
              })
            }
          }
        })
      })
    })
    .on('progress', function(data){
      jwt.verify(data, config.Secret, { algorithm: 'HS256' }, function (err, decoded) {
        console.log(decoded);
        ws.user = decoded.username;
        ws.isAlive = true;
        scanner = ws;
        ws.send(JSON.stringify({
          type: "authentication",
          data: null,
          message: "Authenticated",
          status: 1
        }));
        ws.on('update', function(data){
          adminPanel.set("panelStatus", data);
        })
      })
    })
    .on("panel", function (data) {
      jwt.verify(data, config.Secret, { algorithm: 'HS256' }, function (err, decoded) {
        console.log(decoded);
        if (err) {
          ws.send(JSON.stringify({
            type: "authentication",
            data: null,
            message: "Auth Failed " + err.message,
            status: 1
          }));
          ws.terminate();
        }else{
          ws.user = decoded.username;
          ws.isAlive = true;
          ws.send(JSON.stringify({
            type: "authentication",
            data: null,
            message: "Authenticated",
            status: 1
          }));
          setTimeout(() => {
            ws.send(JSON.stringify({
              type: "update",
              data: adminPanel.get("panelStatus"),
              message: "Success",
              status: 1
            }));
          }, 1000);
          setInterval(() => {
            if (scanner) {
              ws.send(JSON.stringify({
                type: "update",
                data: adminPanel.get("panelStatus"),
                message: "Success",
                status: 1
              }));
            } else {
              ws.send(JSON.stringify({
                type: "update",
                data: { player: { current: 0, max: 0 }, crawler: { current: 0, max: 0 }, scanner: { current: 0, max: 0 } },
                message: "Success",
                status: 1
              }));
            }
          }, 10000);
        }
      })
    })
    .on('orgs', function(data){
      ws.user = "Scanner";
      ws.isAlive = true;
      console.log(ws.user+" Connected ["+wss.clients.size+"]");
      ws.send(JSON.stringify({
        type:"response",
        data:"Ready for jobs.",
        message:"Success",
        status:1
      }));
      ws.on('job', function(data){
        var org, length, pages, counter = 1, orgResponse = [];
        async function scan(sid, ws){
          if(Array.isArray(org)){
            wss.clients.forEach((ws, i) => {
              if(ws.user == "Scanner"){
                ws.send(JSON.stringify({
                  type:"status",
                  data:"Getting Members of "+sid+" "+counter+" of "+org.length,
                  message:"Success",
                  status:1
                }));
              }
            });
          }else{
            wss.clients.forEach((ws, i) => {
              if(ws.user == "Scanner"){
                ws.send(JSON.stringify({
                  type:"status",
                  data:"Getting Members of "+sid,
                  message:"Success",
                  status:1
                }));
              }
            });
          }
          await orgScan(sid).then(async (result) => {
            if(result.status === 0){
              throw new Error(sid);
            }else{
              console.log(result);
              pages = result.data;
              counter++;
              for(var xx = 0; xx < result.data; xx++){
                orgLimiter.schedule( { id:sid+" - "+(xx+1)+"/"+result.data } , getNames, sid, xx)
                .catch((error)=>{
                  wss.clients.forEach((ws, i) => {
                    if(ws.user == "Scanner"){
                      ws.send(JSON.stringify({
                        type:"error",
                        data:error,
                        message:"There was an error getting org members, members may be missing so run "+sid+" to ensure you have every member.",
                        status:0
                      }));
                    }
                  });
                });
              }
            }
          });
        }
        async function getNames(sid, page){
          wss.clients.forEach((ws, i) => {
            if(ws.user == "Scanner"){
              ws.send(JSON.stringify({
                type:"status",
                data:"Running "+sid+" member list.",
                message:"Success",
                status:1
              }));
            }
          });
          await orgPlayers(sid, page).then((result)=>{
            if(result.status == 1){
              result.data.forEach((item, i) => {
                orgResponse.push(item);
              });
              if(Array.isArray(org)){
                org = org.filter(function(item, pos, self) {
                  return self.indexOf(item) == pos;
                })
                console.log(orgResponse);
                console.log(org[org.length-1]+" | "+sid);
                if(org[org.length-1] === sid){
                  console.log((page+1)+" | "+pages);
                  if((page+1) == pages){
                    wss.clients.forEach((ws, i) => {
                      if(ws.user == "Scanner"){
                        ws.send(JSON.stringify({
                          type:"finished",
                          data:orgResponse,
                          message:"Finished "+org.length+" organizations and found "+orgResponse.length+" players.",
                          status:1
                        }));
                      }
                    });
                  }
                }
              }else{
                if((page+1) == pages){
                  wss.clients.forEach((ws, i) => {
                    if(ws.user == "Scanner"){
                      ws.send(JSON.stringify({
                        type:"finished",
                        data:orgResponse,
                        message:"Finished "+sid,
                        status:1
                      }));
                    }
                  });
                }
              }
            }
          })
        }
        try{
          org = JSON.parse(data);
        }catch(err){
          if(err) org = data.toUpperCase();
        }
        if(Array.isArray(org)){
          for(var i = 0; i < org.length; i++){
            org[i] = org[i].toUpperCase();
            orgLimiter.schedule( {id:org[i]+" - Get Members"}, scan, org[i], ws)
            .catch((error) => {
              console.log(error.message);
              org.forEach((item, i) => {
                if(item == error.message){
                  org.splice(i, 1);
                }
              });
              wss.clients.forEach((ws, i) => {
                if(ws.user == "Scanner"){
                  ws.send(JSON.stringify({
                    type:"error",
                    data:null,
                    message:error.message+" returned Null.",
                    status:0
                  }));
                }
              });
            })
          }
        }else{
          orgLimiter.schedule( {id:org}, scan, org, ws)
          .catch((error) => {
            wss.clients.forEach((ws, i) => {
              if(ws.user == "Scanner"){
                ws.send(JSON.stringify({
                  type:"error",
                  data:null,
                  message:error.message,
                  status:0
                }));
              }
            });
          })
        }
      })
    })
})
wss.on('error', (err) =>{
  console.log(err);
})

const interval = setInterval(function (){
  wss.clients.forEach((item, i) => {
    if(item.isAlive === false){
      console.log("Terminating "+item.user);
      item.terminate();
    }else{
      item.isAlive = false;
    }
  });
}, 30000 + 1000);

wss.on('close', function close(e) {
  clearInterval(interval);
});

async function init(){
  key = await getKey();
  setInterval(() => {
    wss.clients.forEach((item, i)=>{
      if(!item.user){
        item.terminate();
      }
    })
  }, 10000);
}

function getKey(){
  return new Promise(callback =>{
    var apiKey;
    const sql = "SELECT id, apiKey, count FROM apiKeys WHERE note like '%main%' GROUP BY id, apiKey, count ORDER BY count desc LIMIT 1";
    con.query(sql, function (err, result, fields){
      if(err) throw err;
      apiKey = result[0].apiKey;
      callback(apiKey);
    });
  })
}

const queryApi = function(username, key){
  return new Promise(callback => {
    var options = {
      hostname: 'api.dustytavern.com',
      port: 443,
      path: '/user/'+escape(username),
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
            callback({status:0, data:args+" returned null."});
          }
        }catch(err){
          var result = "Failed to parse "+username;
          callback({ status:0, data:result });
        };
        if(user){
          if(Object.size(user.data) > 0){
            var sql = "SELECT reviewed_count AS vouches FROM players WHERE username LIKE '"+username+"'";
            con.query(sql, function (err, result, fields){
              if(err) throw err;
              if(result.length > 0){
                user.data.profile.rating = api.xp(result[0].vouches)+" ["+result[0].vouches+"]";
              }else{
                user.data.profile.rating = api.xp(0)+" [0]";
              }
              cachePlayer(user.data);
              callback({ status:1, data:user.data });
            })
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

function cachePlayer(user) {
  var download = function (uri, filename, callback) {
    request.head(uri, function (err, res, body) {
      console.log('content-type:', res.headers['content-type']);
      console.log('content-length:', res.headers['content-length']);

      request(uri).pipe(fs.createWriteStream(filename)).on('close', callback);
    });
  };
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
      try{
        data.bio = JSON.parse(data.bio);
      }catch{

      }
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
      /*
      if (check.cID > data.cID){
        update = true;
        eventUpdate.push("Obtained ID");
      }
      */
      if (data.username !== check.username) {
        update = true;
        eventUpdate.push("Changed Name");
      }
      if(data.badge.title !== check.badge.title){
        update = true;
        eventUpdate.push("Badge Changed");
      }
      if(data.avatar !== check.avatar){
        update = true;
        var stamp = Date.now();
        download(check.avatar, "/var/www/html/src/avatars/"+check.username+"-"+stamp+".png", function () {
          check.avatar = "https://mobitracker.co/src/avatars/"+check.username+"-"+stamp+".png";
        });
        eventUpdate.push("Avatar Changed");
      }
      if(data.bio !== check.bio){
        update = true;
        console.log({old: data.bio, new: check.bio});
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

function orgScan(sid){
  return new Promise(callback => {
    var options = {
      hostname: 'api.starcitizen-api.com',
      port: 443,
      path: '/'+key+'/v1/live/organization/'+escape(sid),
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
          var org = JSON.parse(body);
          if(org.data == null){
            callback({status:0, data:sid+" returned null."});
          }
        }catch(err){
          var result = "Failed to parse "+sid;
          callback({ status:0, data:result });
        };
        if(org){
          if(Object.size(org.data) > 0){
            var grossPages = Math.ceil(org.data.members/32);
            console.log(org.data.members+" / "+32);
            callback({ status:1, data:grossPages });
          }else{
            callback({ status:0, data:sid+" not found." });
          }
        }else{
          callback({ status:0, data:"Server Error." });
        }
      })
    })
    req.on('error', (err) => {
      callback({ status:0, data:err});
    })
    req.end();
  });
}

function orgPlayers(sid, page){
  return new Promise(callback => {
    var options = {
      hostname: 'api.starcitizen-api.com',
      port: 443,
      path: '/'+key+'/v1/live/organization_members/'+escape(sid)+"?page="+page,
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
            callback({status:0, data:sid+" returned null."});
          }
        }catch(err){
          var result = "Failed to parse "+sid;
          callback({ status:0, data:result });
        };
        if(user){
          if(Object.size(user.data) > 0){
            var result = [];
            user.data.forEach((item, i) => {
              result.push(item.handle);
            });
            callback({ status:1, data:result });
          }else{
            callback({ status:0, data:sid+" not found." });
          }
        }else{
          callback({ status:0, data:"Server Error." });
        }
      })
    })
    req.on('error', (err) => {
      callback({ status:0, data:err});
    })
    req.end();
  });
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

function comparer(otherArray) {
  return function (current) {
    return otherArray.filter(function (other) {
      return other.sid == current.sid && other.rank == current.rank
    }).length == 0;
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
