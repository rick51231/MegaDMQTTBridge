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
        if(port.query!==undefined) {
            port.query.forEach(function (type) {
                let timeout = Math.floor(Math.random() * Math.floor(params.interval * 1000));

                console.log('[INIT] Setting query delay: ' + timeout + ' for:' + node + '/' + portId + '/' + type);

                setTimeout(function () {
                    queryPort(node, portId, type);
                }, timeout);
            });
        }

        if(port.type!=='') {
            let timeout = Math.floor(Math.random() * Math.floor(params.interval*1000));

            console.log('[INIT] Setting query delay: '+timeout+' for:'+node+'/'+portId+'/'+port.type+' (default)');

            setTimeout(function () {
                queryPort(node, portId, port.type, true);
            }, timeout);
        }
    });


}


function queryPort(node, port, type, isDefault = false) {
    let dev = config.devices[node];
    let urlType = type;
    let i2c_par = 0;

    let url = 'http://'+dev.ip+'/'+dev.password+'/?pt='+port;

    if(isDefault) {
        url += '&cmd=' + (type==='1wbus' ? 'list' : 'get');
    } else {
        if(type.startsWith('htu21d-')) { //htu21d-h -> 0, htu21d-t -> 1
            urlType = 'htu21d';

            if(type.substr(-1)==='t')
                i2c_par = 1;
        } else if(type==='bmx280') {
            i2c_par = 3;
        }

        url += '&scl='+dev.ports[port].scl+'&i2c_dev='+urlType+'&i2c_par='+i2c_par;
    }


    //console.log('[CLIENT] Query: '+url);
    fetch(url, { timeout: 5000 })
        .then(res => res.text())
        .then(function (body) {
            let value = body;

            if(type==='t67xx') {
                if (value === '65535' || value === '767' || value === '1279') {
                    console.log('[CLIENT] invalid: value:' + value + ' port:' + node + '/' + port + '/' + type);
                    return;
                }

                value = {co2: value};
            } else if(type==='max44009') {
                value = { light: value };
            } else if(type.startsWith('htu21d-')) {
                if(type.substr(-1)==='t')
                    value = { temp: value };
                else
                    value = { hum: value };
            } else if(type==='htu21d') {
                let result = value.match(/temp:([\d\-.]*)\/hum:([\d.]*)/i);

                value = { temp: parseFloat(result[1]), hum: parseFloat(result[2]) };
            } else if(type==='bmx280') {
                let result = value.match(/temp:([\d\-.]*)\/press:([\d.]*)\/hum:([\d.]*)/i);

                value = {temp: parseFloat(result[1]), press: parseFloat(result[2]), hum: parseFloat(result[3])};
            } else if(type==='1wbus') {
                const data = value.match(/([a-f\d]{12}):([\d\-.]*)/gi);

                value = {};

                data.forEach(function (item) {
                    const tmpItem = item.split(':');
                    value[tmpItem[0]] = parseFloat(tmpItem[1]);
                })
            } else {
                value = { value: value };
            }

            value = JSON.stringify(value);

            mqttSend(node, port, value);
        })
        .catch(err => console.log('[CLIENT] error: '+err));


    setTimeout(function () {
        queryPort(node, port, type, isDefault);
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
    const port = queryObject.searchParams.get('pt');

    // console.log(queryObject.searchParams);
    console.log("[Server] Query: "+request.url);

    if(port !== undefined && config.devices[node]!==undefined) {//} && config.devices[node].ip===response.socket.remoteAddress) {
        const mode = queryObject.searchParams.get('m') === '1' ? 'OFF' : 'ON';

        mqttSend(node, port, mode);

        response.end();
        return;
    }

    response.statusCode = 404;
    response.write("Not Found");
    response.end();
}