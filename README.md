# MegaD MQTT Bridge
Allows you to connect MegaD-2561 via MQTT.

Board have native MQTT support, but in my case it's incompatible with cisco switch and i've created this module.
In addition, it allows me to customize mqtt message format.

Please note, that not all MegaD features are supported here.

# Installation
* Clone repository
* Install packages with `npm install` 
* Copy config.sample.js to config.js and edit it
* In the MegaD settings, set ``SRV`` to ``server_ip:port`` (example: ``192.168.0.10:8080``), ``SRV TYPE`` to ``HTTP``, ``Script`` to device's name from ``config.js`` (example ``mega1``)
* Run with `node main.js`
* Optionally, you can add it to the systemd (example unit in megad_mqtt_bridge.service)