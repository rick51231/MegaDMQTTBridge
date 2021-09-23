// Rename this file to the config.js

//Do not remove this block
var config = {};
config.core = {};
config.mqtt = {};
config.devices = {};

//Core settings
config.core.httpPort = 8008; //HTTP server bind port
config.core.httpAddress = '127.0.0.1'; //HTTP server bind address

//MQTT settings
config.mqtt.host = ''; //MQTT server host
config.mqtt.port = 1883; //MQTT server port
config.mqtt.username = ''; //MQTT server username
config.mqtt.password = ''; //MQTT server password
config.mqtt.prefix = 'megad_mqtt_bridge'; //MQTT topic prefix
config.mqtt.retain = true; //MQTT retain flag

//Example device:
config.devices.mega1 = {
    ip: '127.0.0.1', //Megad ip address
    password: '', //Megad password
    interval: 30, //Query interval
    resync: 300, //Resync interval
    ports: [],
    rs485: {}
};

//Devices types: max44009 light, t67xx co2, htu21d temp/hum (only type), htu21d-t temp (only query), htu21d-h hum (only query), bmx280 temp/hum/press (only type), 1wbus temp (only type), hm3301 dust (only query?)
//TODO: hm3301 - работать с type=hm3301
//type - Port callback type, '' - for none,
//scl - SCL port number for i2c devices
//query - Types for http query
config.devices.mega1.ports[0] = { type: '', scl: 0, query: ['hum'] };

// RS485 devices
// Currently the DDS238 is only supported
config.devices.mega1.rs485['dds238'] = 30; // Format: ['device_type'] = interval

module.exports = config; //This should be the last line
