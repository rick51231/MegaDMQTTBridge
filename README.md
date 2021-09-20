# MegaD MQTT Bridge
Allows you to connect MegaD-2561 via MQTT.

Board have native MQTT support, but in my case it's incompatible with cisco switch and i've created this module.
In addition, it allows me to customize mqtt message format.

Please note, that not all MegaD features are supported here.

# Installation
* Clone repository
* Install packages with `npm install` 
* Copy config.sample.js to config.js and edit it
* Run with `node main.js`
* Optionally, you can add it to the systemd (example unit in megad_mqtt_bridge.service)