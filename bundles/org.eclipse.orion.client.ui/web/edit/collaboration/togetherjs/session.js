/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

define(["require", "util", "channels", "jquery", "storage"], function (require, util, channels, $, storage) {

  var DEBUG = true;

  // This is the amount of time in which a hello-back must be received after a hello
  // for us to respect a URL change:
  var HELLO_BACK_CUTOFF = 1500;

  var session = util.mixinEvents(util.Module("session"));
  var assert = util.assert;

  // We will load this module later (there's a circular import):
  var peers;

  // This is the hub we connect to:
  session.shareId = null;
  // This is the ID that identifies this client:
  session.clientId = null;
  session.router = channels.Router();
  // Indicates if TogetherJS has just started (not continuing from a saved session):
  session.firstRun = false;
  //Indicates whether or not the initial content has been received (for receivers)
  session.received_initContent = false;
  //Time allowed until content received fail.
  session.CONTENTRECEIVE_TIMER = 10000;
  // This is the key we use for localStorage:
  var localStoragePrefix = "togetherjs.";
  // This is the channel to the hub:
  session.channel = null;

  // Setting, essentially global:
  session.AVATAR_SIZE = 90;

  var MAX_SESSION_AGE = 30*24*60*60*1000; // 30 days

  session.ot = null;

  /****************************************
   * URLs
   */
  var includeHashInUrl = TogetherJS.config.get("includeHashInUrl");
  TogetherJS.config.close("includeHashInUrl");
  var currentUrl = (location.href + "").replace(/\#.*$/, "");
  if (includeHashInUrl) {
    currentUrl = location.href;
  }

  session.hubUrl = function (id) {
    id = id || session.shareId;
    assert(id, "URL cannot be resolved before TogetherJS.shareId has been initialized");
    TogetherJS.config.close("hubBase");
    var hubBase = TogetherJS.config.get("hubBase");
    return hubBase.replace(/\/*$/, "") + "/hub/" + id;
  };

  session.shareUrl = function () {
    assert(session.shareId, "Attempted to access shareUrl() before shareId is set");
    var hash = location.hash;
    var m = /\?[^#]*/.exec(location.href);
    var query = "";
    if (m) {
      query = m[0];
    }
    hash = hash.replace(/&?togetherjs-[a-zA-Z0-9]+/, "");
    hash = hash || "#";
    if (!session.isClient) {
        return location.protocol + "//" + location.host + "/scratchpad" + hash.substring(6, hash.length) + "&togetherjs=" + session.shareId + "?username=" + TogetherJS.config.get("creatorUsername");
    } else {
        return location.protocol + "//" + location.host + "/scratchpad" + hash.substring(28, hash.length) + "&togetherjs=" + session.shareId + "?username=" + TogetherJS.config.get("creatorUsername");
    }
  };

  session.recordUrl = function () {
    assert(session.shareId);
    var url = TogetherJS.baseUrl.replace(/\/*$/, "") + "/togetherjs/recorder.html";
    url += "#&togetherjs=" + session.shareId + "&hubBase=" + TogetherJS.config.get("hubBase");
    return url;
  };

  session.currentUrl = function () {
    if (includeHashInUrl) {
      if (location.hash.indexOf('/sharedWorkspace') == 1) {
        //get everything after 'workspace name'
        var workspace = 'mo/mourad/OrionContent/'
        var index = location.hash.indexOf(workspace);
        return location.hash.substring(index + workspace.length, location.hash.length);
      } else {
        var loc = '/file/';
        var index = location.hash.indexOf(loc);
        return location.hash.substring(index + loc.length, location.hash.length);
      }
        // if (location.href == TogetherJS.config.get("sessionFileUrl")) {
        //     var loc = location.href;
        //     var re = /scratchpad([\/])(.*)/;
        //     return (loc.substring(0, loc.indexOf('file/') + 'file/'.length) + loc.match(re)[2]);
        // }
        // else {
        //     return location.href;
        // }
    } else {
      return location.href.replace(/#.*/, "");
    }
  };


  /****************************************
   * Message handling/dispatching
   */

  session.hub = util.mixinEvents({});

  var IGNORE_MESSAGES = TogetherJS.config.get("ignoreMessages");
  if (IGNORE_MESSAGES === true) {
    DEBUG = false;
    IGNORE_MESSAGES = [];
  }
  // These are messages sent by clients who aren't "part" of the TogetherJS session:
  var MESSAGES_WITHOUT_CLIENTID = ["who", "invite", "init-connection", "close_yourself"];

  // We ignore incoming messages from the channel until this is true:
  var readyForMessages = false;

  function openChannel() {
    // assert(! session.channel, "Attempt to re-open channel");
    // session.channel = null;
    console.info("Connecting to", session.hubUrl(), location.href);
    var c = channels.WebSocketChannel(session.hubUrl(), session.clientId);
    c.myUrl = session.currentUrl();
    c.onmessage = function (msg) {
      if (msg.type == 'authenticated') {
        window.require(['orion/collab/collabClient'], function(collabClient) {
          collabClient.collabSocket.setSocket(c);
        });
      }
      // if (! readyForMessages) {
      //   if (DEBUG) {
      //     console.info("In (but ignored for being early):", msg);
      //   }
      //   return;
      // }
      if (DEBUG && IGNORE_MESSAGES.indexOf(msg.type) == -1) {
        console.info("In:", msg);
      }
      if (! peers && msg.type !== 'init-connection') {
        // We're getting messages before everything is fully initialized
        console.warn("Message received before all modules loaded (ignoring):", msg);
        return;
      }
      if ((! msg.clientId) && MESSAGES_WITHOUT_CLIENTID.indexOf(msg.type) == -1) {
        console.warn("Got message without clientId, where clientId is required", msg);
        return;
      }
      if (msg.clientId) {
        msg.peer = peers.getPeer(msg.clientId, msg);
      }
      if (msg.type == "hello" || msg.type == "hello-back" || msg.type == "peer-update") {
        // We do this here to make sure this is run before any other
        // hello handlers:
        msg.peer.updateFromHello(msg);
      }
      if (msg.peer) {
        msg.sameUrl = msg.peer.url == session.currentUrl();
        if (!msg.peer.isSelf) {
          msg.peer.updateMessageDate(msg);
        }
      }
      session.hub.emit(msg.type, msg);
      TogetherJS._onmessage(msg);
    };
    session.channel = c;
    session.router.bindChannel(session.channel);
    TogetherJS.connected = true;
  }
  
  session.editorLoaded = function(model) {
    session.textModel = model;
    if (!session.channel) {
      setTimeout(function() {
        session.editorLoaded(model);
      }, 2000);
      return;
    }
    var myUrl = session.currentUrl();
    var msg = {
      'type': 'join-document',
      'currentUrl': myUrl
    }
    session.send(msg);
  };

  session.startOT = function(revision, model, operation) {
    session.ot = new ot.EditorClient(revision-1, [], session.channel, new ot.OrionAdapter(model));
    session.channel.trigger('operation', operation);
  };

  session.addClientData = function(msg) {
    msg.name = peers.Self.name || peers.Self.defaultName,
    msg.color =  peers.Self.color,
    msg.url = session.currentUrl(),
    msg.urlHash =  location.hash
    return msg;
  }

  session.send = function (msg) {
    if (msg.type == 'request-init-content') {
      //check peers
      var thePeers = peers.getAllPeers();
      var myUrl = session.currentUrl();
      var withYou = thePeers.some(function(peer) {
        return peer.url == myUrl;
      });
      if (!withYou) {
        session.received_initContent = true;
        return;
      }
    }
    if (DEBUG && IGNORE_MESSAGES.indexOf(msg.type) == -1) {
      console.info("Send:", msg);
    }
    msg.clientId = session.clientId;
    session.channel.send(msg);
  };

  session.appSend = function (msg) {
    var type = msg.type;
    if (type.search(/^togetherjs\./) === 0) {
      type = type.substr("togetherjs.".length);
    } else if (type.search(/^app\./) === -1) {
      type = "app." + type;
    }
    msg.type = type;
    session.send(msg);
  };

  /****************************************
   * Standard message responses
   */

  /* Always say hello back, and keep track of peers: */
  session.hub.on("hello hello-back", function (msg) {
    if (msg.type == "hello") {
      sendHello(true);
    }
    if (session.isClient && (! msg.isClient) &&
        session.firstRun && session.timeHelloSent &&
        Date.now() - session.timeHelloSent < HELLO_BACK_CUTOFF) {
      processFirstHello(msg);
    }
  });

  session.hub.on("who", function (msg) {
    sendHello(true);
  });

  session.hub.on("init-connection", function (msg) {
    var msg = {
      'type': 'authenticate',
      'token': localStorage.getItem('orionSocket.authToken')
    };
    session.send(msg);
  });

  function processFirstHello(msg) {
    if (! msg.sameUrl) {
      var url = msg.url;
      if (msg.urlHash) {
        url += msg.urlHash;
      }
      require("ui").showUrlChangeMessage(msg.peer, url);
      // location.href = url;
    }
  }

  session.timeHelloSent = null;

  function sendHello(helloBack) {
    var msg = session.makeHelloMessage(helloBack);
    if (! helloBack) {
      session.timeHelloSent = Date.now();
      peers.Self.url = msg.url;
    }
    session.send(msg);
  }

  session.makeHelloMessage = function (helloBack) {
    var msg = {
      name: peers.Self.name || peers.Self.defaultName,
      avatar: peers.Self.avatar,
      color: peers.Self.color,
      url: session.currentUrl(),
      urlHash: location.hash,
      // FIXME: titles update, we should track those changes:
      title: document.title,
      rtcSupported: session.RTCSupported,
      isClient: session.isClient
    };
    if (helloBack) {
      msg.type = "hello-back";
    } else {
      msg.type = "hello";
      msg.clientVersion = TogetherJS.version;
    }
    if (! TogetherJS.startup.continued) {
      msg.starting = true;
    }
    // This is a chance for other modules to effect the hello message:
    session.emit("prepare-hello", msg);
    return msg;
  };
  /****************************************
   * Lifecycle (start and end)
   */

  // These are Javascript files that implement features, and so must
  // be injected at runtime because they aren't pulled in naturally
  // via define().
  // ui must be the first item:
  var features = ["peers", "ui", "chat", "startup", "forms", "visibilityApi"];

  function getRoomName(prefix, maxSize) {
    var findRoom = TogetherJS.config.get("hubBase").replace(/\/*$/, "") + "/findroom";
    return $.ajax({
      url: findRoom,
      dataType: "json",
      data: {prefix: prefix, max: maxSize}
    }).then(function (resp) {
      return resp.name;
    });
  }

  function initIdentityId() {
    return util.Deferred(function (def) {
      if (session.identityId) {
        def.resolve();
        return;
      }
      storage.get("identityId").then(function (identityId) {
        if (! identityId) {
          identityId = util.generateId();
          storage.set("identityId", identityId);
        }
        session.identityId = identityId;
        if (!session.identityId){
            def.reject("Failed to set IdentityID");
        }
        // We don't actually have to wait for the set to succede, so
        // long as session.identityId is set
        def.resolve();
      });
    });
  }

  initIdentityId.done = initIdentityId();

  function initShareId(projectSessionID) {
    return util.Deferred(function (def) {
      var hash = location.hash;
      var shareId = session.shareId;
      var isClient = true;
      var set = true;
      var sessionId;
      var reason = TogetherJS.startup.reason;
      session.firstRun = ! TogetherJS.startup.continued;
      if (! shareId) {
        if (TogetherJS.startup._joinShareId) {
          // Like, below, this *also* means we got the shareId from the hash
          // (in togetherjs.js):
          shareId = TogetherJS.startup._joinShareId;
        }
      }
      return storage.tab.get("status").then(function (saved) {
        var findRoom = TogetherJS.config.get("findRoom");
        TogetherJS.config.close("findRoom");
        if (findRoom && saved && findRoom != saved.shareId) {
          console.info("Ignoring findRoom in lieu of continued session");
        } else if (findRoom && TogetherJS.startup._joinShareId) {
          console.info("Ignoring findRoom in lieu of explicit invite to session");
        }
        if (findRoom && typeof findRoom == "string" && (! saved) && (! TogetherJS.startup._joinShareId)) {
          isClient = true;
          shareId = findRoom;
          sessionId = util.generateId();
        } else if (findRoom && (! saved) && (! TogetherJS.startup._joinShareId)) {
          assert(findRoom.prefix && typeof findRoom.prefix == "string", "Bad findRoom.prefix", findRoom);
          assert(findRoom.max && typeof findRoom.max == "number" && findRoom.max > 0,
                 "Bad findRoom.max", findRoom);
          sessionId = util.generateId();
          if (findRoom.prefix.search(/[^a-zA-Z0-9]/) != -1) {
            console.warn("Bad value for findRoom.prefix:", JSON.stringify(findRoom.prefix));
          }
          getRoomName(findRoom.prefix, findRoom.max).then(function (shareId) {
            // FIXME: duplicates code below:
            session.clientId = session.identityId + "." + sessionId;
            storage.tab.set("status", {reason: "joined", shareId: shareId, running: true, date: Date.now(), sessionId: sessionId});
            session.isClient = true;
            session.shareId = shareId;
            session.emit("shareId");
            def.resolve(session.shareId);
          });
          return;
        } else if (TogetherJS.startup._launch) {
            //starting the session
            //here we deal with reopened or refreshed tabs
            if (saved && saved.running == true) {
                isClient = saved.reason == "joined";
                reason = saved.reason;
                sessionId = saved.sessionId
                shareId = saved.shareId;
            } else {
                isClient = TogetherJS.startup.reason == "joined";
            }
            if (! sessionId) {
                sessionId = util.generateId();
            }
            if (! shareId) {
               shareId = util.generateId();
            }
        } else if (saved) {
          isClient = saved.reason == "joined";
          reason = saved.reason;
          TogetherJS.startup.continued = true;
          shareId = saved.shareId;
          sessionId = saved.sessionId;
          // The only case when we don't need to set the storage status again is when
          // we're already set to be running
          set = ! saved.running;
        } else {
          throw new util.AssertionError("No saved status, and no startup._launch request; why did TogetherJS start?");
        }
        assert(session.identityId);
        session.clientId = session.identityId + "." + sessionId;
        if (set) {
          storage.tab.set("status", {reason: reason, shareId: shareId, running: true, date: Date.now(), sessionId: sessionId});
        }
        session.isClient = isClient;
        session.shareId = shareId;
        /**tempppppp**/
        session.shareId = projectSessionID;
        session.emit("shareId");
        def.resolve(session.shareId);
      });
    });
  }

  function initStartTarget() {
    var id;
    if (TogetherJS.startup.button) {
      id = TogetherJS.startup.button.id;
      if (id) {
        storage.set("startTarget", id);
      }
      return;
    }
    storage.get("startTarget").then(function (id) {
      var el = document.getElementById(id);
      if (el) {
        TogetherJS.startup.button = el;
      }
    });
  }
  session.start = function (projectSessionID) {
    if (!projectSessionID) {
      projectSessionID = TogetherJS.config.get("projectSessionID");
    }
    assert(projectSessionID);
    TogetherJS.config("sessionFileUrl", location.href);
    initStartTarget();
    initIdentityId().then(function () {
      initShareId(projectSessionID).then(function () {
        readyForMessages = false;
        openChannel();
        require(["ui"], function (ui) {
          TogetherJS.running = true;
          ui.prepareUI();
          require(features, function () {
            $(function () {
              peers = require("peers");
              var startup = require("startup");
              session.emit("start");
              session.once("ui-ready", function () {
                readyForMessages = true;
                startup.start();
              });
              if (!session.isClient) {
                TogetherJS.config.get("getUserName")().then(function(username) {
                  TogetherJS.config("creatorUsername", username);
                  ui.activateUI();
                });
              } else {
                ui.activateUI();
              }
              TogetherJS.config.close("enableAnalytics");
              if (TogetherJS.config.get("enableAnalytics")) {
                require(["analytics"], function (analytics) {
                  analytics.activate();
                });
              }
              peers._SelfLoaded.then(function () {
                sendHello(false);
                //send init position
                lineChanged({'detail':{'line': 0}});
              });
              TogetherJS.emit("ready");
            });
          });
        });
      });
    });
  };

  session.close = function (reason) {
    TogetherJS.running = false;
    var event = new CustomEvent("destroyCollabAnnotations", {"detail": {"all": true}});
    document.dispatchEvent(event);
    var msg = {type: "bye"};
    if (reason) {
      msg.reason = reason;
    }
    session.send(msg);
    session.emit("close");
    var name = window.name;
    storage.tab.get("status").then(function (saved) {
      if (! saved) {
        console.warn("No session information saved in", "status." + name);
      } else {
        saved.running = false;
        saved.date = Date.now();
        storage.tab.set("status", saved);
      }
      session.channel.close();
      session.channel = null;
      session.shareId = null;
      session.emit("shareId");
      TogetherJS.emit("close");
      TogetherJS._teardown();
    });
  };

  session.on("start", function () {
    $(window).on("resize", resizeEvent);
    if (includeHashInUrl) {
      $(window).on("hashchange", hashchangeEvent);
    }
  });

  session.on("close", function () {
    $(window).off("resize", resizeEvent);
    if (includeHashInUrl) {
      $(window).off("hashchange", hashchangeEvent);
    }
  });

  function hashchangeEvent() {
    // needed because when message arives from peer this variable will be checked to
    // decide weather to show actions or not
    session.channel.myUrl = session.currentUrl();
    sendHello(false);
  }

  function resizeEvent() {
    session.emit("resize");
  }

  if (TogetherJS.startup._launch) {
    setTimeout(session.start);
  }

  util.testExpose({
    getChannel: function () {
      return session.channel;
    }
  });

  return session;
});
