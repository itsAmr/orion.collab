/* Initializes websocket connection */

define([], function() {
	var hubUrl = "ws://localhost:80/hub/";
	function CollabSocket(id) {
		this.socket = null;
		this.createSocket(id);
	}

	CollabSocket.prototype = {
		createSocket: function(id) {
			this.socket = new WebSocket(hubUrl + id);
		    
		    var self = this;

		    this.socket.onmessage = function(event) {
		      var msg = JSON.parse(event.data);

		      switch(msg.type) {
		        case "client_left":
		          self.trigger('client_left', msg.clientId);
		          break;
		        case "set_name":
		          self.trigger('set_name', msg.clientId, msg.name);
		          break;
		        case "ack":
		          self.trigger('ack');
		          break;
		        case "operation":
		          self.trigger('operation', msg.operation);
		          self.trigger('selection', msg.clientId, msg.selection);
		          break;
		        case "selection":
		          self.trigger('selection', clientId, selection);
		          break;
		        case "reconnect":
		          self.trigger('reconnect');
		          break;
		      }
		    }
		},
	};

	CollabSocket.prototype.constructor = CollabSocket;

	return CollabSocket;
});