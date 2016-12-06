
/*eslint-env browser, amd */
define(['orion/editor/eventTarget'], function(mEventTarget) {
	
	var collabSocket = {
		socket: null,
		setSocket: function(websocket) {
			this.socket = websocket;
			if (this.dispatchEvent) {
				this.dispatchEvent({type: "Open"});
			}
		},

		destroySocket: function() {
			this.socket = null;
			if (this.dispatchEvent) {
				this.dispatchEvent({type: "Closed"});
			}
		}
	};
	

	/**
	* As soon as the collabSocket.socket value gets set or unset, a collabClient needs to be notified.
	* So when creating a collabClient, need to have a listener on changes to collabSocket.socket
	*/
	function CollabClient(editor) {
		this.editor = editor;
		this.textView = null;
		var self = this;
		mEventTarget.EventTarget.addMixin(collabSocket);
		this.editor.addEventListener("ModelLoaded", function(event) {self.viewInstalled.call(self, event)});
		this.editor.addEventListener("TextViewUninstalled", function(event) {self.viewUninstalled.call(self, event)});
		this.ot = null;
		this.otOrionAdapter;
		this.collabSocket = collabSocket;
		this.collabSocket.addEventListener("Open", self.socketConnected.bind(self));
//		this.collabSocket.addEventListener("Closed", self.socketDisconnected.bind(self));
		this.socket = this.collabSocket.socket;
		window.addEventListener("hashchange", function() {self.destroyOT.call(self)})
	}

	CollabClient.prototype = {
		initSocket: function() {
			var self = this;
			
			//Add the necessary functions to the socket so we can run an OT session.
		  	this.socket.sendOperation = function (revision, operation, selection) {
		  		var myDoc = self.currentDoc();
			    var msg = {
			      'type': 'operation',
			      'revision': revision,
			      'operation': operation,
			      'selection': selection,
			      'doc': myDoc,
			      'clientId': this.clientId
			    };
			    this.send(JSON.stringify(msg));
		  	};

		 	this.socket.sendSelection = function (selection) {
		  		var myDoc = self.currentDoc();
			    var msg = {
			      'type': 'selection',
			      'selection': selection,
			      'doc': myDoc,
			      'clientId': this.clientId
			    };
		    	this.send(JSON.stringify(msg));
		  	};

		 	this.socket.registerCallbacks = function (cb) {
		    	this.callbacks = cb;
		  	};

		  	this.socket.trigger = function (event) {
		  		if (!self.textView) return;
			    var args = Array.prototype.slice.call(arguments, 1);
			    var action = this.callbacks && this.callbacks[event];
			    if (action) { action.apply(this, args); }
		  	};

		  	this.socket.docmessage = function(msg) {
		  		if (msg.doc != self.currentDoc() || !self.textView) {
		  			return;
		  		}
		        switch(msg.type) {
		          case "init-document":
		            self.startOT(msg.revision, msg.operation, msg.clients);
		            break;
		          case "client_left":
		          //   this.trigger('client_left', msg.clientId);
		            break;
		          case "client_joined":
		          	var obj = {};
		          	obj[msg.clientId] = msg.client;
		          	this.trigger('clients', obj);
		          	break;
		          case "client_update":
		          	break;
		          case "set_name":
		            this.trigger('set_name', msg.clientId, msg.name);
		            break;
		          case "ack":
		            this.trigger('ack');
		            break;
		          case "operation":
		            this.trigger('operation', msg.operation);
		            this.trigger('selection', msg.clientId, msg.selection);
		            break;
		          case "selection":
		            this.trigger('selection', msg.clientId, msg.selection);
		            break;
		          case "reconnect":
		            this.trigger('reconnect');
		            break;
	        	}
			};
		
			//now let's get this started and request the latest doc.
		    var msg = {
		      'type': 'join-document',
		      'doc': this.currentDoc(),
		      'clientId': this.socket.clientId
		    };
		    this.socket.send(msg);
		},

		startOT: function(revision, operation, clients) {
			this.textView.getModel().setText(operation[0], 0);
			this.otOrionAdapter = new ot.OrionAdapter(this.textView);
			this.ot = new ot.EditorClient(revision, clients, this.socket, this.otOrionAdapter);
		},

		destroyOT: function() {
			if (this.ot && this.otOrionAdapter) {
				this.otOrionAdapter.detach();
				this.ot = null;
				var msg = {
			      'type': 'leave-document',
			      'clientId': this.socket.clientId
			    };
			    this.socket.send(msg);
			}
		},

		currentDoc: function() {
			if (location.hash.indexOf('/sharedWorkspace') == 1) {
		        //get everything after 'workspace name'
		        //TODO make this real
		        var workspace = 'mo/mourad/OrionContent/'
		        var index = location.hash.indexOf(workspace);
		        return location.hash.substring(index + workspace.length, location.hash.length);
			} else {
		        var loc = '/file/';
		        var index = location.hash.indexOf(loc);
		        return location.hash.substring(index + loc.length, location.hash.length);
			}
		},

		viewInstalled: function(event) {
			this.textView = this.editor.getTextView();
			//hook the collab annotation
			if (this.socket && !this.socket.closed) {
				this.initSocket();
			}
		},

		viewUninstalled: function(event) {
			this.textView = null;
		},

		docInstalled: function(event) {
			if (this.socket) {
				this.initSocket();
			}
		},

		socketConnected: function() {
			this.socket = this.collabSocket.socket;
			if (this.textView) {
				this.initSocket();
			}
		},

		socketDisconnected: function() {
			this.socket= null;
		}
	};

	CollabClient.prototype.constructor = CollabClient;

	return {
		collabClient: CollabClient,
		collabSocket: collabSocket
	}
});