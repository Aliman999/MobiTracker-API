var jwt = require('jsonwebtoken');
const WebSocket = require('ws');

function socket(){
  var payload = jwt.sign({ username:"bot" }, config.Secret);
  var message;
  webSocket = new WebSocket("wss://ws.mobitracker.co:2599");
  webSocket.onopen = function(){
    console.log("Connected to Internal API");
    message = {
      type:"auth",
      token:payload
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
