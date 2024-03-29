const config  = require('./config');
var jwt = require('jsonwebtoken');
const WebSocket = require('ws');
const fs = require('fs');

var secret = fs.readFileSync('api.secret');

function socket(){
  var payload = jwt.sign({iat:Math.floor(Date.now() / 1000) + (60 * 5)}, secret, { algorithm: 'HS256' });
  var message;
  ws = new WebSocket("wss://ws.mobitracker.co:2599");
  ws.onopen = function(){
    console.log("Connected to Internal API");
    message = {
      type:"auth",
      token:{ org:"teamlegacy", jwt:payload }
    };
    ws.send(JSON.stringify(message));
    heartbeat();
  }
  ws.onerror = function(err){
  }
  ws.onclose = function(){
    console.log("Lost Connection to Internal API");
    setTimeout(socket, 3000);
  };

  ws.onmessage = function(response){
    response = JSON.parse(response.data);
    if(response.type == "authentication"){
      setTimeout(()=>{
        send("history", { type:'user', datatype:'cid', input:"153021" });
      }, 5000)
    }else if (response.type == "response") {
      console.log(response);
    }
  }

  function heartbeat() {
    if (!ws) return;
    if (ws.readyState !== 1) return;
    ws.send(JSON.stringify({type:"ping"}));
    setTimeout(heartbeat, 3000);
  }

  function send(type, message){
    message = {
      type:type,
      data:message
    }
    console.log(message);
    ws.send(JSON.stringify(message));
  }
}


socket();
