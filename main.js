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

    for (const [dev, interval] of Object.entries(params.rs485)) {
        let timeout = Math.floor(Math.random() * Math.floor(interval*1000));
        console.log('[INIT] Setting rs485 delay: '+timeout+' for:'+node+'/'+dev);

        setTimeout(function () {
            queryRS485(node, dev);
        }, timeout);
    }

    mqttClient.subscribe(config.mqtt.prefix + '/' + node + '/cmd');
    resync(node);
}

async function queryRS485(node, type) { //Going to rewrite this to async...
    let dev = config.devices[node];

    let urlWrite = 'http://' + dev.ip + '/' + dev.password + '/?mode=rs485&uart_tx=';
    let urlRead = 'http://' + dev.ip + '/' + dev.password + '/?uart_rx=1&mode=rs485';
    if(type==='dds238') {
        let query = '0103000C0006'; //Request 6 registers, starting from 0x000C

        fetch(urlWrite + query, {timeout: 5000})
            .then(res => res.text())
            .then(function (body) {

                setTimeout(function () {
                    fetch(urlRead, {timeout: 5000})
                        .then(res => res.text())
                        .then(function (body) {
                            if (body === '' || body === "CRC Error")
                                return;

                            let buffer = Buffer.from(body.split('|').map(function (x) {
                                return parseInt(x, 16)
                            }));

                            let voltage = buffer.readUInt16BE(3) / 10;
                            let current = buffer.readUInt16BE(5) / 100;
                            let power_active = buffer.readInt16BE(7);
                            let power_reactive = buffer.readInt16BE(9);
                            let power_factor = buffer.readUInt16BE(11) / 1000;
                            let frequency = buffer.readUInt16BE(13) / 100;

                            sendPortStatus(node, 'rs485/' + type, {
                                voltage,
                                current,
                                power_active,
                                power_reactive,
                                power_factor,
                                frequency
                            });

                        })
                        .catch(err => console.log('[RS485] error: ' + err));
                }, 100);
            })
            .catch(err => console.log('[RS485] error: ' + err));
    } else if(type==='ddsr9588') {
        let registers = [ //Reg address, reg name, round by
            ['00', 'voltage', 10],
            ['08', 'current', 100],
            ['12', 'power_active', 10],
            ['1A', 'power_reactive', 10],
            ['2A', 'power_factor', 100],
            ['36', 'frequency', 10]
        ];

        let outData = {};

        try {
            for (const reg of registers) { //MegaD can't read all registers at once
                let query = '010400' + reg[0] + '0002';

                await fetch(urlWrite + query, {timeout: 5000});

                await delay(200); // MegaD/DDSR9588 works really slow

                let res = await fetch(urlRead, {timeout: 5000});

                let body = await res.text();

                if (body === '' || body === "CRC Error")
                    throw new Error('Invalid response');

                let buffer = Buffer.from(body.split('|').map(function (x) {
                    return parseInt(x, 16)
                }));

                let val = buffer.readFloatBE(3);

                outData[reg[1]] = Math.round(val * reg[2]) / reg[2];
            }

            sendPortStatus(node, 'rs485/' + type, outData);
        } catch(err) {
            console.log('[RS485] error: ' + err);
        }
    }
    setTimeout(function () {
        queryRS485(node, type);
    }, config.devices[node].rs485[type]*1000);
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
        } else if(type.startsWith('radsens-')) { //radsens-s -> 1, radsens-d -> 2
            urlType = 'radsens';
            i2c_par = type.substr(-1)==='d' ? 2 : 1;
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

                let match_onoff = message.toString().match(/^(\d*):([10])$/);
                if(match_onoff!==null) {
                    sendPortStatus(node, match_onoff[1],  match_onoff[2]==='1' ? 'ON' : 'OFF');
                }

                let match_ext = message.toString().match(/^(\d+)e(\d+):(\d+)$/);
                if(match_ext!==null) {
                    sendPCA9685State(node, parseInt(match_ext[1], 10));
                }

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
    } else if(type.startsWith('radsens')) {
        if (type.substr(-1) === 'd')
            value = {radDynamic: value};
        else
            value = {radStatic: value};
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
    } else if(type==='ptsensor') {
        value = { press: value };
    } else {
        let result = rawValue.match(/(ON|OFF)\/(\d*)/i);

        if(result===null)
            value = rawValue ;
        else
            value = result[1];
    }

    return value;
}

function sendPCA9685State(node, pin) {
    let dev = config.devices[node];

    let url = 'http://'+dev.ip+'/'+dev.password+'/?pt='+pin+'&cmd=get';

    console.log('[PCA9685] Query: '+url);
    fetch(url, { timeout: 5000 })
        .then(res => res.text())
        .then(function (body) {

            let data = body.split(';');

            if(data.length!==16) {
                console.log('[PCA9685] error: invalid length '+body);
                return;
            }

            for(let i = 0; i<data.length; i++) {
                sendPortStatus(node, pin+'e'+i, parseInt(data[i], 10));
            }
        })
        .catch(err => console.log('[PCA9685] error: '+err));
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
                if(data[i]==='PCA') {
                    sendPCA9685State(node, i);
                    continue;
                }

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

function delay(ms) {
    return new Promise((resolve, reject) => {
        setTimeout(resolve, ms);
    });
}