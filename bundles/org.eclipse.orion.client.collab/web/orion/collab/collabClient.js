/*******************************************************************************
 * @license
 * Copyright (c) 2016 IBM Corporation and others.
 * All rights reserved. This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License v1.0
 * (http://www.eclipse.org/legal/epl-v10.html), and the Eclipse Distribution
 * License v1.0 (http://www.eclipse.org/org/documents/edl-v10.html).
 *
 * Contributors: IBM Corporation - initial API and implementation
 ******************************************************************************/

/*eslint-env browser, amd */
define(['orion/editor/eventTarget', 'orion/editor/annotations', 'orion/collab/ot'], function(mEventTarget, mAnnotations, ot) {

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
	function CollabClient(editor, inputManager, fileClient) {
		this.editor = editor;
		this.inputManager = inputManager;
		this.fileClient = fileClient;
		this.textView = null;
		var self = this;
		this.fileClient.addEventListener('Changed', self.sendFileOperation.bind(self));
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
		this.docPeers = {};
		this.awaitingClients = false;
		if (this.socket && !this.socket.closed && this.textView) {
			this.initSocket();
		}
	}

	CollabClient.prototype = {
		initSocket: function() {
			this.inputManager.collabRunning = true;
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
				self.editor.markClean();
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
		            this.trigger('client_left', msg.clientId);
					delete self.docPeers[msg.clientId];
		            break;
		          case "client_joined":
					self.docPeers[msg.clientId] = msg.client;
					this.trigger('client_joined', msg.clientId, self.docPeers[msg.clientId]);
		          	break;
		          case "all_clients":
					self.docPeers = msg.clients;
					this.trigger('clients', self.docPeers);
					self.awaitingClients = false;
					break;
		          case "client_update":
					this.trigger('client_update', msg.clientId, msg.client);
		          	break;
		          case "ack":
		            this.trigger('ack');
		            break;
		          case "operation":
		            this.trigger('operation', msg.operation);
					self.editor.markClean();
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
			if (this.ot) {
				this.otOrionAdapter.detach();
				this.ot = null;
			}
			this.textView.getModel().setText(operation[0], 0);
			this.otOrionAdapter = new ot.OrionAdapter(this.editor, AT);
			this.ot = new ot.EditorClient(revision, clients, this.socket, this.otOrionAdapter, this.socket.clientId);
			this.editor.markClean();
		},

		destroyOT: function() {
			if (this.ot && this.otOrionAdapter) {
				this.otOrionAdapter.detach();
				//reset to regular undo/redo behaviour
				this.editor.getTextActions().init();
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
			var workspace = this.getFileSystemPrefix();
			if (workspace !== '/file/') {
		        //get everything after 'workspace name'
		        return location.hash.substring(location.hash.indexOf(workspace) + workspace.length).split('/').slice(3).join('/');
			} else {
		        return location.hash.substring(location.hash.indexOf(workspace) + workspace.length, location.hash.length);
			}
		},

		getFileSystemPrefix: function() {
			return location.hash.indexOf('/sharedWorkspace') === 1 ? '/sharedWorkspace/tree/file/' : '/file/';
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

		//Moved to OT.js
		// selectionListener: function(e) {
		// 	if (!this.socket) return;
		// 	var currLine = this.editor.getLineAtOffset(e.newValue.start);
		// 	var lastLine = this.editor.getModel().getLineCount()-1;
		// 	var lineStartOffset = this.editor.getLineStart(currLine);
		// 	var offset = e.newValue.start;

		//     if (offset) {
		//         //decide whether or not it is worth sending (if line has changed or needs updating).
		//         if (currLine !== this.myLine || currLine === lastLine || currLine === 0) {
		//         //if on last line and nothing written, send lastline-1 to bypass no annotation on empty line.
		//             if (currLine === lastLine && offset === lineStartOffset) {
		//                 currLine -= 1;
		//             }
		//         } else {
		//             return;
		//         }
		// 	}

		//     this.myLine = currLine;

		//     this.socket.sendSelection(currLine);
		// },

		viewUninstalled: function(event) {
			this.textView = null;
			this.docPeers = {};
		},

		//Not used anymore
		// initializeLineAnnotations: function() {
		// 	for (var key in this.docPeers)	{
		// 		if (!this.docPeers.hasOwnProperty(key)) continue;
		// 		this.updateLineAnnotation(key, this.docPeers[key].selection);
		// 	}
		// },

		//Moved to OT.js
		// updateLineAnnotation: function(id, line = 0, name = 'unknown', color = '#000000') {
		// 	if (this.docPeers[id]) {
		// 		name = this.docPeers[id].username;
		// 		color = this.docPeers[id].usercolor;
		// 	} else {
		// 		console.log("received selection before client was initialized.");
		// 		//ask for the clients
		// 		if (!this.awaitingClients) {
		// 			this.getDocPeers();
		// 			this.awaitingClients = true;
		// 		}
		// 		return;
		// 	}
		// 	var viewModel = this.editor.getModel();
		// 	var annotationModel = this.editor.getAnnotationModel();
		// 	var lineStart = this.editor.mapOffset(viewModel.getLineStart(line));
		// 	if (lineStart === -1) return;
		// 	var ann = AT.createAnnotation(AT.ANNOTATION_COLLAB_LINE_CHANGED, lineStart, lineStart, name + " is editing");
		// 	ann.html = ann.html.substring(0, ann.html.indexOf('></div>')) + " style='background-color:" + color + "'><b>" + name.substring(0,2) + "</b></div>";
		// 	ann.peerId = id;
		// 	var peerId = id;

		// 	/*if peer isn't being tracked yet, start tracking
		// 	* else replace previous annotation
		// 	*/
		// 	if (!(peerId in this.annotations && this.annotations[peerId]._annotationModel)) {
		// 		this.annotations[peerId] = ann;
		// 		annotationModel.addAnnotation(this.annotations[peerId]);
		// 	} else {
		// 		var currAnn = this.annotations[peerId];
		// 		if (ann.start === currAnn.start) return;
		// 		annotationModel.replaceAnnotations([currAnn], [ann]);
		// 		this.annotations[peerId] = ann;
		// 	}
		// },

		//Moved to OT.js
		// destroyCollabAnnotations: function(peerId) {
		// 	var annotationModel = this.editor.getAnnotationModel();
		// 	var currAnn = null;

		// 	/*If a peer is specified, just remove their annotation
		// 	* Else remove all peers' annotations.
		// 	*/
		// 	if (peerId) {
		// 		if (this.annotations[peerId]) {
		// 			//remove that users annotation
		// 			currAnn = this.annotations[peerId];
		// 			annotationModel.removeAnnotation(currAnn);
		// 			delete this.annotations[peerId];
		// 		}
		// 	} else {
		// 		//the session has ended remove everyone's annotation
		// 		annotationModel.removeAnnotations(AT.ANNOTATION_COLLAB_LINE_CHANGED);
		// 		this.annotations = {};
		// 	}
		// },

		docInstalled: function(event) {
			if (this.socket) {
				this.initSocket();
			}
		},

		socketConnected: function() {
			this.socket = this.collabSocket.socket;
			var self = this;
			this.socket.opmessage = function(msg) {
				/**
				** this was supposed to be doc level messages, but we are now adding session level operations like file_operation.
				** so for now we will temporarily allow it through the following way until the togetherjs session management is replaced.
				*/
				if (msg.type == 'file_operation') {
					self.handleFileOperation(msg);
				}
			};
			if (this.textView) {
				this.initSocket();
			}
		},

		socketDisconnected: function() {
			this.socket = null;
			this.inputManager.collabRunning = false;
			this.fileClient.removeEventListener('Changed', this._sendFileOperation);
			this.destroyOT();
		},

		getDocPeers: function() {
		    var msg = {
		      'type': 'get-clients',
		      'doc': this.currentDoc(),
		      'clientId': this.socket.clientId
		    };
		    this.socket.send(msg);
		},

		sendFileOperation: function(evt) {
			if (!this.socket) return;
			if (!this.ignoreNextFileOperation) {
				var operation = evt.created ? 'created' : evt.moved ? 'moved' : evt.deleted ? 'deleted' : evt.copied ? 'copied' : '';
				if (operation) {
				    var msg = {
						'type': 'file_operation',
						'operation': operation,
						'data': evt[operation],
						'clientId': this.socket.clientId
				    };
				    this.socket.send(msg);
				}
			}
			this.ignoreNextFileOperation = false;
		},

		handleFileOperation: function(msg) {
			if (!this.ignoreNextFileOperation) {
				var evt = this.makeFileClientEvent(msg.operation, msg.data);
				this.dispatchFileClientEvent(evt);
			}
			this.ignoreNextFileOperation = false;
		},

		makeFileClientEvent: function(operation, data) {
			/**
			** we can't trigger the event directly since the user might be on a seperate file system.
			*/
			data = data[0];
			var evt = {
				type: "Changed"
			};

			var evtData = {'select': false};

			switch (operation) {
				case 'created':
					var parentLocation = this.maybeTransformLocation(data.parent);
					var result = data.result;
					result.Parents = []; //is parents even needed for this operation?
					result.Location = this.maybeTransformLocation(result.Location);
					evt.created = [{'parent': parentLocation, 'result': result, 'eventData': evtData}];
					break;
				case 'deleted':
					var deleteLocation = this.maybeTransformLocation(data.deleteLocation);
					evt.deleted = [{'deleteLocation': deleteLocation, 'eventData': evtData}];
					break;
				case 'moved':
					var sourceLocation = this.maybeTransformLocation(data.source);
					var targetLocation = this.maybeTransformLocation(data.target);
					var result = data.result;
					result.Parents = []; //is parents even needed for this operation?
					result.Location = this.maybeTransformLocation(result.Location);
					evt.moved = [{'source': sourceLocation, 'target': targetLocation, 'result': result, 'eventData': evtData}];
					break;
				case 'copied':
					var sourceLocation = this.maybeTransformLocation(data.source);
					var targetLocation = this.maybeTransformLocation(data.target);
					var result = data.result;
					result.Parents = []; //is parents even needed for this operation?
					result.Location = this.maybeTransformLocation(result.Location);
					evt.copied = [{'source': sourceLocation, 'target': targetLocation, 'result': result, 'eventData': evtData}];
					break;
			}

			return evt;
		},

		/**
		** For example we potentially need to convert a '/file/web/potato.js' to '/sharedWorkspace/tree/file/web/potato.js'
		** and vice-versa, depending on our file system and the sender's filesystem.
		**/
		maybeTransformLocation: function(Location) {
			var loc = this.getFileSystemPrefix();
			//if in same workspace
			if (Location.indexOf(loc) === 0) {
				return Location;
			} else {
				var oppositeLoc = loc == '/file/' ? '/sharedWorkspace/tree/file/' : '/file/';
				//we need to replace sharedWorkspace... with /file and vice versa.
				// we also need to replace workspace info for shared workspace or add it when its not the case.
				var file = Location.substring(oppositeLoc.length);
				if (loc == '/file/') {
					//since the received location includes workspace info, swap that out.
					file = file.split('/').slice(3).join('/');
				} else {
					//since you need to workspace info, add that in.
					var projectLoc = location.hash.substring(location.hash.indexOf(loc) + loc.length);
					projectLoc = projectLoc.split('/').slice(0,3).join('/') + '/';
					file = projectLoc + file;
				}
				Location = loc + file;
				return Location;
			}
		},

		dispatchFileClientEvent: function(evt) {
			this.ignoreNextFileOperation = true;
			this.fileClient.dispatchEvent(evt);
		}
	};

	CollabClient.prototype.constructor = CollabClient;

	return {
		collabClient: CollabClient,
		collabSocket: collabSocket
	};
});
