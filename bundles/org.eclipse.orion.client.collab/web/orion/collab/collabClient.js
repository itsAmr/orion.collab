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
		window.addEventListener("hashchange", function() {self.destroyOT.call(self)});
		if (this.socket && !this.socket.closed && this.textView) {
			this.initSocket();
		}
		this.myLine = 0;
		this.collabPeers = {};
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
					self.destroyCollabAnnotations(msg.clientId);
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
			var self = this;
			var ruler = this.editor._annotationRuler;
			ruler.addAnnotationType(AT.ANNOTATION_COLLAB_LINE_CHANGED, 1);
			ruler = this.editor._overviewRuler;
			ruler.addAnnotationType(AT.ANNOTATION_COLLAB_LINE_CHANGED, 1);
			this.textView = this.editor.getTextView();
			this.textView.addEventListener('Selection', function(e) {
						var currLine = self.editor.getLineAtOffset(e.newValue.start);
						var lastLine = self.editor.getModel().getLineCount()-1;
						var lineStartOffset = self.editor.getLineStart(currLine);
						var offset = e.newValue.start;

					    if (offset) {
					        //decide whether or not it is worth sending (if line has changed or needs updating).
					        if (currLine !== self.myLine || currLine == lastLine || currLine == 0) {
					        //if on last line and nothing written, send lastline-1 to bypass no annotation on empty line.
					            if (currLine == lastLine && offset == lineStartOffset) {
					                currLine -= 1;
					            }
					        } else {
					            return;
					        }
						}

						//TODO: fetch user name and color!!!

					    self.myLine = currLine;
					    // var msg = {
					    //   'type': "selection",
					    //   'line': line,
					    //   'name': 'temp',
					    //   'color': 'black'
					    // };

					    self.socket.sendSelection(currLine);

					    //update yourself for self-tracking
					    self.updateLineAnnotation(self.socket.clientId, self.myLine);
			});
			//hook the collab annotation
			if (this.socket && !this.socket.closed) {
				this.initSocket();
			}
		},

		viewUninstalled: function(event) {
			this.textView = null;
			this.collabPeers = {};
			this.myLine = 0;
		},


		updateLineAnnotation: function(id, line = 0, name = 'unknown', color = '#000000') {
			var annotationModel = this.editor.getAnnotationModel();
			var viewModel = this.editor.getModel();
			var annotationModel = this.editor.getAnnotationModel();
			var lineStart = this.editor.mapOffset(viewModel.getLineStart(line));
			if (lineStart == -1) return;
			var ann = AT.createAnnotation(AT.ANNOTATION_COLLAB_LINE_CHANGED, lineStart, lineStart, name + " is editing");
			ann.html = ann.html.substring(0, ann.html.indexOf('></div>')) + " style='background-color:" + color + "'><b>" + name.substring(0,2) + "</b></div>";
			var peerId = id;

			/*if peer isn't being tracked yet, start tracking
			* else replace previous annotation
			*/
			if (!(peerId in this.collabPeers)) {
				this.collabPeers[peerId] = {
					'annotation': ann,
					'line': line
				};
				annotationModel.addAnnotation(ann);
			} else {
				var currAnn = this.collabPeers[peerId].annotation;
				if (ann.start == currAnn.start) return;
				annotationModel.replaceAnnotations([currAnn], [ann]);
				this.collabPeers[peerId].annotation = ann;
			}
		},

		destroyCollabAnnotations: function(peerId) {
			var annotationModel = this.editor.getAnnotationModel();
			var currAnn = null;

			/*If a peer is specified, just remove their annotation
			* Else remove all peers' annotations.
			*/
			if (peerId) {
				//remove that users annotation
				currAnn = this.collabPeers[peerId].annotation;
				annotationModel.removeAnnotation(currAnn);
				delete this.collabPeers[peerId];
			} else {
				//the session has ended remove everyone's annotation
				for (var key in this.collabPeers) {
					if (this.collabPeers.hasOwnProperty(key)) {
						currAnn = this.collabPeers[key].annotation;
						annotationModel.removeAnnotation(currAnn);
					}
				}
				this.collabPeers = {};
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
		}
	};

	CollabClient.prototype.constructor = CollabClient;

	return {
		collabClient: CollabClient,
		collabSocket: collabSocket
	}
});
