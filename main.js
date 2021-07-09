require('log-timestamp');
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

    mqttClient.subscribe(config.mqtt.prefix + '/' + node + '/cmd');
    resync(node);
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

    let qStart = new Date();

    //console.log('[CLIENT] Query: '+url);
    fetch(url, { timeout: 5000 })
        .then(res => res.text())
        .then(function (body) {
            let value = formatParam(node, port, type, body);

            if(value===false)
                return;

            let qTime = (new Date()).getTime() - qStart.getTime();
            console.log('[CLIENT] delay '+node+'/'+port+'/'+type+'/'+isDefault+': '+qTime);

            sendPortStatus(node, port + (isDefault ? '' : '/' + type), value);
        })
        .catch(err => console.log('[CLIENT] error: '+err));


    setTimeout(function () {
        queryPort(node, port, type, isDefault);
    }, config.devices[node].interval*1000);
}


function mqttSend(prefix, subTopic, message) {
    let topic = config.mqtt.prefix+'/'+prefix+'/'+subTopic;
    mqttClient.publish(topic, message.toString(),{ retain: config.mqtt.retain });
    console.log('['+topic+'] Send: '+message.toString());
}

function onMqttMessage(topic, message) { //, packet
    console.log('['+topic+'] Receive: '+message.toString());

    if(topic.startsWith(config.mqtt.prefix+'/') && topic.endsWith('/cmd')) {
        let node = topic.substr(config.mqtt.prefix.length+1).slice(0, -4);
        if(config.devices[node]===undefined)
            return;

        let url = 'http://' + config.devices[node].ip + '/' + config.devices[node].password + '/?cmd=' + message;

        fetch(url, { timeout: 5000 })
            .then(res => res.text())
            .then(function (body) {
                if(body!=="Done")
                    return;

                let m = message.toString().match(/^(\d*):([10])$/);

                if(m===null)
                    return;

                sendPortStatus(node, m[1],  m[2]==='1' ? 'ON' : 'OFF');
            })
            .catch(err => console.log('[CMD] error: '+err));
    }

}

function formatParam(node, port, type, rawValue) {
    if(rawValue==='')
        return false;

    let value = parseFloat(rawValue);

    if(type==='t67xx') {
        if ((value - 255) % 256 === 0 || value === 0) {
            console.log('[CLIENT] invalid: value:' + rawValue + ' port:' + node + '/' + port + '/' + type);
            return false;
        }

        value = { co2: value };
    } else if(type==='max44009') {
        value = { light: value };
    } else if(type.startsWith('htu21d-')) {
        if(type.substr(-1)==='t')
            value = { temp: value };
        else
            value = { hum: value };
    } else if(type==='htu21d') {
        let result = rawValue.match(/temp:([\d\-.]*)\/hum:([\d.]*)/i);

        value = { temp: parseFloat(result[1]), hum: parseFloat(result[2]) };
    } else if(type==='bmx280') {
        let result = rawValue.match(/temp:([\d\-.]*)\/press:([\d.]*)\/hum:([\d.]*)/i);

        value = {temp: parseFloat(result[1]), press: parseFloat(result[2]), hum: parseFloat(result[3])};
    } else if(type==='hm3301') {
        let result = rawValue.match(/pm1:([\d]*)\/pm2\.5:([\d]*)\/pm10:([\d]*)/i);

        value = {pm1: parseFloat(result[1]), pm2_5: parseFloat(result[2]), pm10: parseFloat(result[3])};
    } else if(type==='1wbus') {
        const data = rawValue.match(/([a-f\d]{12}):([\d\-.]*)/gi);

        value = {};

        data.forEach(function (item) {
            const tmpItem = item.split(':');
            value[tmpItem[0]] = parseFloat(tmpItem[1]);
        })
    } else {
        let result = rawValue.match(/(ON|OFF)\/(\d*)/i);

        if(result===null)
            value = rawValue ;
        else
            value = result[1];
    }

    return value;
}

function resync(node) {
    let dev = config.devices[node];

    let url = 'http://'+dev.ip+'/'+dev.password+'/?cmd=all';

    console.log('[RESYNC] Query: '+url);
    fetch(url, { timeout: 5000 })
        .then(res => res.text())
        .then(function (body) {

            let data = body.split(';');

            if(data.length<20 || data.length>50) {
                console.log('[RESYNC] error: invalid length '+body);
                return;
            }

            for(let i = 0; i<data.length; i++) {
                try {
                    let type = config.devices[node].ports[i] === undefined ? '' : config.devices[node].ports[i].type;
                    let value = formatParam(node, i, type, data[i]);

                    if (value !== false)
                        sendPortStatus(node, i, value);
                } catch (e) {
                    console.log('[RESYNC] '+node+'/'+i+' error: '+e)
                }
            }
        })
        .catch(err => console.log('[RESYNC] error: '+err));


    setTimeout(function () {
        resync(node);
    }, config.devices[node].resync*1000);
}

function onHttpRequest(request, response) {
    response.statusCode = 200;


    const queryObject = new URL(request.url, 'http://localhost');
    const node = queryObject.pathname.substr(1);
    const port = queryObject.searchParams.get('pt');

    // console.log(queryObject.searchParams);
    console.log("[Server] Query: "+request.url);

    if(port !== undefined && config.devices[node]!==undefined && config.devices[node].ip===response.socket.remoteAddress) {
        const m = queryObject.searchParams.get('m');
        const v = queryObject.searchParams.get('v');

        let value = 'OFF';
        if(m===null && v!==null) {
            value = v === '1' ? 'ON' : 'OFF';
        } else {
            if(m==='2') {
                response.end();
                return;
            }

            value = m === '1'  ? 'OFF' : 'ON';
        }

        sendPortStatus(node, port, value);

        response.end();
        return;
    }

    response.statusCode = 404;
    response.write("Not Found");
    response.end();
}

function sendPortStatus(node, port, value) {
    mqttSend(node, port, JSON.stringify({ value: value }));
}