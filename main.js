let config = require('./config.js');

const http = require("http");
const mqtt = require('mqtt');
const fetch = require('node-fetch');


const mqttClient = mqtt.connect('mqtt://'+config.mqtt.host, {
    port: config.mqtt.port,
    username: config.mqtt.username,
    password: config.mqtt.password
});
http.createServer(onHttpRequest).listen(config.core.httpPort, config.core.httpAddress);

mqttClient.on('message', onMqttMessage);
mqttClient.subscribe('');

for (const [node, params] of Object.entries(config.devices)) {
    params.ports.forEach(function (port, portId) {
        port.query.forEach(function(type) {
            let timeout = Math.floor(Math.random() * Math.floor(params.interval*1000));

            console.log('[INIT] Setting query delay: '+timeout+' for:'+node+'/'+portId+'/'+type);

            setTimeout(function () {
                queryPort(node, portId, type);
            }, timeout);
        });
    });
}


function queryPort(node, port, type) {
    let dev = config.devices[node];
    let url = 'http://'+dev.ip+'/'+dev.password+'/?pt='+port+'&scl='+dev.ports[port].scl+'&i2c_dev='+type;

    console.log('[CLIENT] Query: '+url);
    fetch(url, { timeout: 5 })
        .then(res => res.text())
        .then(function (body) {
            let value = body;

            if(type==='t67xx') {
                if(value==='65535' || value==='767' || value==='1279') {
                    console.log('[CLIENT] invalid: value:'+value+' port:'+node+'/'+port+'/'+type);
                    return;
                }
            }

            mqttSend(node, port, value);
        })
        .catch(err => console.log('[CLIENT] error: '+err));


    setTimeout(function () {
        queryPort(node, port, type);
    }, config.devices[node].interval*1000);
}


function mqttSend(prefix, subTopic, message) {
    let topic = 'megad_mqtt_bridge/'+prefix+'/'+subTopic;
    mqttClient.publish(topic, message.toString() ); //, { retain: true }
    console.log('['+topic+'] Send: '+message.toString());
}

function onMqttMessage(topic, message) { //, packet
    console.log('['+topic+'] Receive: '+message.toString());

}

function onHttpRequest(request, response) {
    response.statusCode = 200;


    const queryObject = new URL(request.url, 'http://localhost');
    const node = queryObject.pathname.substr(1);

    console.log(queryObject.searchParams);
    console.log("[Server] Query: "+request.url);

    if(config.devices[node]!==undefined && config.devices[node].ip===response.socket.remoteAddress) {

        response.write("Hi");
        response.end();
        return;
    }

    response.statusCode = 404;
    response.write("Not Found");
    response.end();
}