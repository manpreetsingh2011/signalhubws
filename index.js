var events = require('events')
var WebSocket = require('uws');
var through2 = require('through2')
var inherits = require('inherits')

function MonClient(app, urls) {
  this.sockets = []
  this.channels = new Map
  var countOpen = 0
  this.opened = false

  // manage URLs
  urls = urls.map(function (url) {
    url = url.replace(/\/$/, '')
    return url.indexOf('://') === -1 ? 'ws://' + url : url
  })

  for (var index = 0; index < urls.length; index++) {
    var socket = new WebSocket(`${urls[index]}/${app}`)

    this.sockets.push(socket)

    socket.on('open', () => {
      if (++countOpen === urls.length) {
        this.opened = true
        this.emit('open')
        for (let channel of this.channels.values()) {
          channel.emit('open')
        }
      }
    })

    socket.on('message', (message) => {
      this.onMessage(message)
    });
  }
}

inherits(MonClient, events.EventEmitter)

MonClient.prototype.subscribe = function(channel) {
  if (this.closed) {
    throw new Error('Cannot subscribe after close')
  }

  if (this.channels.has(channel)) {
    return this.channels.get(channel)
  }

  // allow stream for channel
  // this.channels[channel] = through2.obj()
  this.channels.set(channel, through2.obj())

  this.channels.get(channel).on('close', function() {
    this.channels.remove(channel)
  })
  if (this.opened) {
    process.nextTick(() => {
      if (this.channels.has(channel)) {
        this.channels.get(channel).emit('open')
      }
    })
  }
  return this.channels.get(channel)

}

MonClient.prototype.broadcast = function(channel, message, cb) {
  if (this.closed) throw new Error('Cannot broadcast after close')

  var data = {
    channel: channel,
    message: message
  }
  var pending = this.sockets.length
  var errors = 0

  this.sockets.forEach((socket) => {
    socket.send(JSON.stringify(data), (err) => {
      if (err) {
        return cb(err)
      }

      if (--pending) {
        return
      }

      cb && cb()
    });
  })
}

MonClient.prototype.onMessage = function(message) {
  message = JSON.parse(message)

  for (let key of this.channels.keys()) {
    if (Array.isArray(key)) {
      for (var i=0; i<key.length; i++) {
        if (key[i] === message.channel) {
          this.channels.get(key).write(message.message)
        }
      }
      continue
    }

    if (message.channel === key) {
      this.channels.get(key).write(message.message)
    }
  }
}

MonClient.prototype.close = function (cb) {
  if (this.closed) return
  this.closed = true

  for(let channel of this.channels.values()) {
    channel.end()
  }

  this.channels.clear()
  if (cb) this.once('close', cb)
  var len = this.sockets.length
  if (len === 0) {
    this.emit('close')
    return
  }

  var closed = 0
  this.sockets.forEach((socket) => {
    socket.once('close', () => {
      if (++closed === len) {
        this.emit('close')
      }
    })
    process.nextTick(function () {
      socket.close()
    })
  })
}

module.exports = function(app, urls) {
  return new MonClient(app, urls)
}
