/*eslint-env browser, amd */
define(['orion/editor/eventTarget', 'orion/editor/annotations'], function(mEventTarget, mAnnotations) {

	var AT = mAnnotations.AnnotationType;
	
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
	function CollabClient(editor, inputManager) {
		this.editor = editor;
		this.inputManager = inputManager;
		this.textView = null;
		var self = this;
		this.selectionListener = this.selectionListener.bind(this);
		mEventTarget.EventTarget.addMixin(collabSocket);
		this.editor.addEventListener("ModelLoaded", function(event) {self.viewInstalled.call(self, event);});
		this.editor.addEventListener("TextViewUninstalled", function(event) {self.viewUninstalled.call(self, event);});
		this.ot = null;
		this.otOrionAdapter = null;
		this.collabSocket = collabSocket;
		this.collabSocket.addEventListener("Open", self.socketConnected.bind(self));
		this.collabSocket.addEventListener("Closed", self.socketDisconnected.bind(self));
		this.socket = this.collabSocket.socket;
		window.addEventListener("hashchange", function() {self.destroyOT.call(self);});
		this.myLine = 0;
		this.docPeers = {};
		this.annotations = {};
		this.awaitingClients = false;
		if (this.socket && !this.socket.closed && this.textView) {
			this.initSocket();
		}
	}

	CollabClient.prototype = {
		initSocket: function() {
			this.inputManager.collabRunning = true;
			var self = this;
			this.textView.addEventListener('Selection', self.selectionListener);
			
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
				if (msg.doc !== self.currentDoc() || !self.textView) {
		  			return;
		  		}
		        switch(msg.type) {
		          case "init-document":
					self.docPeers = msg.clients;
		            self.startOT(msg.revision, msg.operation, msg.clients);
		            self.awaitingClients = false;
		            break;
		          case "client_left":
		          //   this.trigger('client_left', msg.clientId);
					self.destroyCollabAnnotations(msg.clientId);
					delete self.docPeers[msg.clientId];
		            break;
		          case "client_joined":
		          	var obj = {};
		          	obj[msg.clientId] = msg.client;
		          	this.trigger('clients', obj);
					self.docPeers[msg.clientId] = msg.client;
					self.updateLineAnnotation(msg.clientId, msg.client.selection);
		          	break;
		          case "all_clients":
					self.docPeers = msg.clients;
					self.initializeLineAnnotations();
					self.awaitingClients = false;
					break;
		          case "client_update":
		          	break;
		          case "set_name":
		            //this.trigger('set_name', msg.clientId, msg.name);
		            break;
		          case "ack":
		            this.trigger('ack');
		            break;
		          case "operation":
		            this.trigger('operation', msg.operation);
		            // this.trigger('selection', msg.clientId, msg.selection);
		            break;
		          case "selection":
		            // this.trigger('selection', msg.clientId, msg.selection);
				    self.updateLineAnnotation(msg.clientId, msg.selection);
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
		    this.destroyCollabAnnotations();
		    this.socket.send(msg);
		},

		startOT: function(revision, operation, clients) {
			if (this.ot) {
				this.otOrionAdapter.detach();
				this.ot = null;
			}
			this.textView.getModel().setText(operation[0], 0);
			this.otOrionAdapter = new ot.OrionAdapter(this.textView);
			this.ot = new ot.EditorClient(revision, clients, this.socket, this.otOrionAdapter);
			this.initializeLineAnnotations();
		},

		destroyOT: function() {
			if (this.ot && this.otOrionAdapter) {
				this.otOrionAdapter.detach();
				this.ot = null;
				if (this.socket) {
					var msg = {
				      'type': 'leave-document',
				      'clientId': this.socket.clientId
				    };
				    this.socket.send(msg);
				}
			}
		},

		currentDoc: function() {
			if (location.hash.indexOf('/sharedWorkspace') === 1) {
		        //get everything after 'workspace name'
		        var workspace = '/sharedWorkspace/tree/file/';
		        return location.hash.substring(location.hash.indexOf(workspace) + workspace.length).split('/').slice(3).join('/');
			} else {
		        var loc = '/file/';
		        var index = location.hash.indexOf(loc);
		        return location.hash.substring(index + loc.length, location.hash.length);
			}
		},

		viewInstalled: function(event) {
			this.docPeers = {};
			var self = this;
			var ruler = this.editor._annotationRuler;
			ruler.addAnnotationType(AT.ANNOTATION_COLLAB_LINE_CHANGED, 1);
			ruler = this.editor._overviewRuler;
			ruler.addAnnotationType(AT.ANNOTATION_COLLAB_LINE_CHANGED, 1);
			this.textView = this.editor.getTextView();

			//hook the collab annotation
			if (this.socket && !this.socket.closed) {
				this.initSocket();
			}
		},

		selectionListener: function(e) {
			if (!this.socket) return;
			var currLine = this.editor.getLineAtOffset(e.newValue.start);
			var lastLine = this.editor.getModel().getLineCount()-1;
			var lineStartOffset = this.editor.getLineStart(currLine);
			var offset = e.newValue.start;

		    if (offset) {
		        //decide whether or not it is worth sending (if line has changed or needs updating).
		        if (currLine !== this.myLine || currLine === lastLine || currLine === 0) {
		        //if on last line and nothing written, send lastline-1 to bypass no annotation on empty line.
		            if (currLine === lastLine && offset === lineStartOffset) {
		                currLine -= 1;
		            }
		        } else {
		            return;
		        }
			}

		    this.myLine = currLine;

		    this.socket.sendSelection(currLine);

		    //update yourself for self-tracking
		    this.updateLineAnnotation(this.socket.clientId, this.myLine);
		},

		viewUninstalled: function(event) {
			this.textView.removeEventListener('Selection', this.selectionListener);
			this.textView = null;
			this.docPeers = {};
			this.myLine = 0;
		},

		initializeLineAnnotations: function() {
			for (var key in this.docPeers)	{
				if (!this.docPeers.hasOwnProperty(key)) continue;
				this.updateLineAnnotation(key, this.docPeers[key].selection);
			}
		},

		updateLineAnnotation: function(id, line = 0, name = 'unknown', color = '#000000') {
			if (this.docPeers[id]) {
				name = this.docPeers[id].username;
				color = this.docPeers[id].usercolor;
			} else {
				console.log("received selection before client was initialized.");
				//ask for the clients
				if (!this.awaitingClients) {
					this.getDocPeers();
					this.awaitingClients = true;
				}
				return;
			}
			var viewModel = this.editor.getModel();
			var annotationModel = this.editor.getAnnotationModel();
			var lineStart = this.editor.mapOffset(viewModel.getLineStart(line));
			if (lineStart === -1) return;
			var ann = AT.createAnnotation(AT.ANNOTATION_COLLAB_LINE_CHANGED, lineStart, lineStart, name + " is editing");
			ann.html = ann.html.substring(0, ann.html.indexOf('></div>')) + " style='background-color:" + color + "'><b>" + name.substring(0,2) + "</b></div>";
			ann.peerId = id;
			var peerId = id;

			/*if peer isn't being tracked yet, start tracking
			* else replace previous annotation
			*/
			if (!(peerId in this.annotations && this.annotations[peerId]._annotationModel)) {
				this.annotations[peerId] = ann;
				annotationModel.addAnnotation(this.annotations[peerId]);
			} else {
				var currAnn = this.annotations[peerId];
				if (ann.start === currAnn.start) return;
				annotationModel.replaceAnnotations([currAnn], [ann]);
				this.annotations[peerId] = ann;
			}
		},

		destroyCollabAnnotations: function(peerId) {
			var annotationModel = this.editor.getAnnotationModel();
			var currAnn = null;

			/*If a peer is specified, just remove their annotation
			* Else remove all peers' annotations.
			*/
			if (peerId) {
				if (this.annotations[peerId]) {
					//remove that users annotation
					currAnn = this.annotations[peerId];
					annotationModel.removeAnnotation(currAnn);
					delete this.annotations[peerId];
				}
			} else {
				//the session has ended remove everyone's annotation
				annotationModel.removeAnnotations(AT.ANNOTATION_COLLAB_LINE_CHANGED);
				this.annotations = {};
			}
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
			this.socket = null;
			this.inputManager.collabRunning = false;
			if (this.textView) {
				this.textView.removeEventListener('Selection', this.selectionListener);
			}
			this.destroyCollabAnnotations();
			this.destroyOT();
		},

		getDocPeers: function() {
		    var msg = {
		      'type': 'get-clients',
		      'doc': this.currentDoc(),
		      'clientId': this.socket.clientId
		    };
		    this.socket.send(msg);
		}
	};

	CollabClient.prototype.constructor = CollabClient;

	return {
		collabClient: CollabClient,
		collabSocket: collabSocket
	};
});
