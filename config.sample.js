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

//Example device:
config.devices.mega1 = {
    ip: '127.0.0.1', //Megad ip address
    password: '', //Megad password
    interval: 30, //Query interval
    ports: []
};

//Devices types: max44009 light, t67xx co2, htu21d temp/hum (only type), htu21d-t temp (only query), htu21d-h hum (only query), bmx280 temp/hum/press (only type)
//type - Port callback type, '' - for none,
//scl - SCL port number for i2c devices
//query - Types for http query
config.devices.mega1.ports[0] = { type: '', scl: 0, query: ['hum'] };

module.exports = config; //This should be the last line