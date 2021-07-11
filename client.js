const config  = require('./config');
var jwt = require('jsonwebtoken');
const WebSocket = require('ws');
const fs = require('fs');

var publicKey = fs.readFileSync('api_rsa.key.pub');

function socket(){
  var payload = jwt.sign({exp:Math.floor(Date.now() / 1000) + (60 * 60)}, publicKey, { algorithm: 'RS256' });
  var message;
  ws = new WebSocket("wss://ws.mobitracker.co:2599");
  ws.onopen = function(){
    console.log("Connected to Internal API");
    message = {
      type:"rsa",
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
      user("JamesDusky");
    }else if (response.type == "response") {
      console.log(response.data);
    }
  }

  function heartbeat() {
    if (!ws) return;
    if (ws.readyState !== 1) return;
    ws.send(JSON.stringify({type:"ping"}));
    setTimeout(heartbeat, 3000);
  }

  function user(user){
    message = {
      type:"user",
      token:"JamesDusky"
    }
    ws.send(JSON.stringify(message));
  }
}


socket();
