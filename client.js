const config  = require('./config');
var jwt = require('jsonwebtoken');
const WebSocket = require('ws');
const fs = require('fs');

var publicKey = fs.readFileSync('api.key.pub');

function socket(){
  var payload = jwt.sign({
      exp:Math.floor(Date.now() / 1000) + (60 * 60),
      foo:"bar"
    }, publicKey, { algorithm: 'RS256' });
  var message;
  webSocket = new WebSocket("wss://ws.mobitracker.co:2599");
  webSocket.onopen = function(){
    console.log("Connected to Internal API");
    message = {
      type:"rsa",
      token:{ org:"evilorg", jwt:payload }
    };
    webSocket.send(JSON.stringify(message));
    heartbeat();
  }
  webSocket.onerror = function(err){
  }
  webSocket.onclose = function(){
    console.log("Lost Connection to Internal API");
    setTimeout(socket, 3000);
  };

  function heartbeat() {
    if (!webSocket) return;
    if (webSocket.readyState !== 1) return;
    webSocket.send(JSON.stringify({type:"ping"}));
    setTimeout(heartbeat, 3000);
  }
}


socket();
