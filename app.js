'use strict';

var BeoSound = require('node-beosound-essence'),
  RoonApi = require('node-roon-api'),
  RoonApiSettings = require('node-roon-api-settings'),
  RoonApiStatus = require('node-roon-api-status'),
  RoonApiTransport = require('node-roon-api-transport');

var playingstate = '';
var core;
var roon = new RoonApi({
  extension_id: 'com.gyttja.beosoundessence.controller',
  display_name: 'BeoSound Essence remote volume controller',
  display_version: '0.0.1',
  publisher: 'gyttja',
  email: 'david',
  website: 'https://github.com/dfuchslin/',

  core_paired: function (core_) {
    core = core_;

    let transport = core.services.RoonApiTransport;
    transport.subscribe_zones(function (cmd, data) {
      try {
        if (cmd == 'Changed' && data['zones_changed']) {
          data.zones_changed.forEach((z) => {
            if (z.outputs) {
              let found = false;
              z.outputs.forEach((o) => {
                console.log(o.output_id, mysettings.zone.output_id);
                found = found || o.output_id == mysettings.zone.output_id;
              });
              if (found) {
                if (playingstate != z.state) {
                  playingstate = z.state;
                  update_led();
                }
              }
            }
          });
        }
      } catch (e) {}
    });
  },
  core_unpaired: function (core_) {
    core = undefined;
  },
});

var mysettings = Object.assign(
  {
    zone: null,
    pressaction: 'togglemute',
    longpressaction: 'stop',
    longpresstimeout: 500,
    rotateaction: 'volume',
    led: 'on',
    seekamount: 5,
    rotationdampener: 1,
  },
  roon.load_config('settings') || {}
);

function makelayout(settings) {
  var l = {
    values: settings,
    layout: [],
    has_error: false,
  };

  l.layout.push({
    type: 'zone',
    title: 'Zone',
    setting: 'zone',
  });

  if (settings.rotateaction != 'none') {
    l.layout.push({
      type: 'dropdown',
      title: 'Rotation Dampener',
      values: [
        { title: 'None', value: 1 },
        { title: 'Some', value: 3 },
        { title: 'More', value: 5 },
        { title: 'Most', value: 7 },
      ],
      setting: 'rotationdampener',
    });
  }

  return l;
}

var svc_settings = new RoonApiSettings(roon, {
  get_settings: function (cb) {
    cb(makelayout(mysettings));
  },
  save_settings: function (req, isdryrun, settings) {
    let l = makelayout(settings.values);
    req.send_complete(l.has_error ? 'NotValid' : 'Success', { settings: l });

    if (!isdryrun && !l.has_error) {
      mysettings = l.values;
      svc_settings.update_settings(l);
      roon.save_config('settings', mysettings);
    }
  },
});

var svc_status = new RoonApiStatus(roon);

roon.init_services({
  required_services: [RoonApiTransport],
  provided_services: [svc_settings, svc_status],
});

var beosound = {};

function update_status() {
  if (beosound.hid) {
    svc_status.set_status('BeoSound Essence remote connected', false);
  } else {
    svc_status.set_status('BeoSound Essence remote disconnected', true);
  }
}

function setup_beosound() {
  if (beosound.hid) {
    beosound.hid.close();
    beosound.hid = undefined;
  }

  try {
    beosound.hid = new BeoSound();
    beosound.hid.on('volumeup', ev_volumeup);
    beosound.hid.on('volumedown', ev_volumedown);
    beosound.hid.on('playpause', ev_playpause);
    beosound.hid.on('stop', ev_stop);
    beosound.hid.on('next', ev_next);
    beosound.hid.on('previous', ev_previous);
    beosound.hid.on('disconnected', () => {
      delete beosound.hid;
      update_status();
    });
    update_status();
  } catch (e) {
    if (
      new Date().getMinutes() % 5 === 0 &&
      new Date().getSeconds() % 60 === 0
    ) {
      console.log(e.message);
    }
  }
}

function ev_volumeup() {
  ev_wheelturn(0.5);
}

function ev_volumedown() {
  ev_wheelturn(-0.5);
}

function ev_playpause() {
  // core.services.RoonApiTransport.control(mysettings.zone, 'playpause');
}

function ev_stop() {
  // core.services.RoonApiTransport.control(mysettings.zone, 'stop');
}

function ev_previous() {}

function ev_next() {}

let wheelpostime = 0;
let wheelpos = 0;
function ev_wheelturn(delta) {
  let now = new Date().getTime();
  if (!wheelpostime || now - wheelpostime > 750) {
    wheelpos = delta;
  } else {
    wheelpos += delta;
  }
  wheelpostime = now;

  let t = wheelpos / mysettings.rotationdampener;
  if (t >= 1 || t <= -1) {
    if (t > 0) t = Math.floor(t);
    else t = Math.ceil(t);
    wheelpos -= t * mysettings.rotationdampener;

    console.log('powermate turned', t);
    if (!core) return;
    if (!mysettings.zone) return;
    //if (mysettings.rotateaction == "volume") core.services.RoonApiTransport.change_volume(mysettings.zone, 'relative_step', t);
    //else if (mysettings.rotateaction == "seek") core.services.RoonApiTransport.seek(mysettings.zone, 'relative', t * mysettings.seekamount);
    core.services.RoonApiTransport.change_volume(
      mysettings.zone,
      'relative_step',
      t
    );
  }
}

setup_beosound();
update_status();
setInterval(() => {
  if (!beosound.hid) setup_beosound();
}, 1000);

roon.start_discovery();
