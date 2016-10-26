/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

define(["jquery", "util", "session", "elementFinder", "eventMaker", "templating", "ot"], function ($, util, session, elementFinder, eventMaker, templating, ot) {
  var forms = util.Module("forms");
  var assert = util.assert;

  // This is how much larger the focus element is than the element it surrounds
  // (this is padding on each side)
  var FOCUS_BUFFER = 5;

  var inRemoteUpdate = false;

  function suppressSync(element) {
    var ignoreForms = TogetherJS.config.get("ignoreForms");
    if (ignoreForms === true) {
      return true;
    }
    else {
      return $(element).is(ignoreForms.join(",")); 
    }
  }

  function maybeChange(event) {
    // Called when we get an event that may or may not indicate a real change
    // (like keyup in a textarea)
    change(event);
  }

  function change(event) {
    sendData({
      element: event.target.activeElement,
      value: event.originalEvent.detail.e
      // value: event.target.activeElement.innerText
    });
  }

  function sendData(attrs) {
    var el = $(attrs.element);
    assert(el);
    var tracker = attrs.tracker;
    var value = attrs.value;
    if (inRemoteUpdate) {
      return;
    }
    var location = elementFinder.elementLocation(el);
    var msg = {
      type: "form-update",
      element: location
    };
    var history = ot.simpleHistorySingleton;
    if (history) {
        if (history.current == value) {
            return;
        }
        var delta = ot.TextReplace.fromChange(history.current, value);
        assert(delta);
        history.add(delta);
        maybeSendUpdate(msg.element, history, tracker);
        return;
    } else {
        msg.value = value;
        msg.basis = 1;
        ot.simpleHistorySingleton = ot.SimpleHistory(session.clientId, value, 1);
    }
    session.send(msg);
  }

  function isCheckable(el) {
    el = $(el);
    var type = (el.prop("type") || "text").toLowerCase();
    if (el.prop("tagName") == "INPUT" && ["radio", "checkbox"].indexOf(type) != -1) {
      return true;
    }
    return false;
  }

  var editTrackers = {};
  var liveTrackers = [];

  TogetherJS.addTracker = function (TrackerClass, skipSetInit) {
    assert(typeof TrackerClass === "function", "You must pass in a class");
    assert(typeof TrackerClass.prototype.trackerName === "string",
           "Needs a .prototype.trackerName string");
    // Test for required instance methods.
    "destroy update init makeInit tracked".split(/ /).forEach(function(m) {
      assert(typeof TrackerClass.prototype[m] === "function",
             "Missing required tracker method: "+m);
    });
    // Test for required class methods.
    "scan tracked".split(/ /).forEach(function(m) {
      assert(typeof TrackerClass[m] === "function",
             "Missing required tracker class method: "+m);
    });
    editTrackers[TrackerClass.prototype.trackerName] = TrackerClass;
    if (!skipSetInit) {
      setInit();
    }
  };

  var OrionEditor = util.Class({

    trackerName: "OrionEditor",
    modelChangedEvent: "Changed",

    constructor: function (model) {
      this.model = model;
      this.element = "div.textviewContent";
      assert(model);
      this._change = this._change.bind(this);
      this.model.addEventListener(this.modelChangedEvent, this._change);
      this.requestInit();
    },
    
    tracked: function (el) {
        // return this.element === $(el)[0];
        return true;
    },

    destroy: function (el) {
        this.model.removeEventListener(this.modelChangedEvent, this._change);
    },
    
    setContent: function(e) {
        this.model.setText(e.msg.text, e.msg.start, e.msg.start + e.msg.del, true);
    },

    update: function (msg) {
      this.model.setText(msg.text);
    },

    init: function (update, msg) {
        //recreate history?
      this.update(update);
    },

    requestInit: function() {
      //if client then get the initial content
      if (session.isClient) {
        //make sure init content is received within x seconds
        setTimeout(function() {
            if (!session.received_initContent) {
                session.close("failed to receive initial content, the file owner is not in the session.");
            }
        }, session.CONTENTRECEIVE_TIMER);

        var msg = {
            type: "request-init-content",
            element: location
        };

        //request content
        session.send(msg);
      }
    },

    makeInit: function () {
      return {
        element: this.element,
        tracker: this.trackerName,
        value: {
            text: this.getContent()
        }
      };
    },

    _editor: function () {
      return this.element.env;
    },

    _change: function (event) {
      // FIXME: I should have an internal .send() function that automatically
      // asserts !inRemoteUpdate, among other things
      if (inRemoteUpdate) {
        return;
      }
      sendData({
        tracker: this.trackerName,
        element: this.element,
        value: this.getContent()
      });
    },

    getContent: function() {
      return this.model.getText();
    }
  });

  OrionEditor.scan = function () {
    return true;
  };

  OrionEditor.tracked = function (el) {
    return true;
  };

  TogetherJS.addTracker(OrionEditor, true /* skip setInit */);

  function buildTrackers() {
    assert(! liveTrackers.length);
    util.forEachAttr(editTrackers, function (TrackerClass) {
      var els = TrackerClass.scan();
      if (els) {
        $.each(els, function () {
          var tracker = new TrackerClass(this);
          ot.simpleHistorySingleton = ot.SimpleHistory(session.clientId, tracker.getContent(), 1);
          liveTrackers.push(tracker);
        });
      }
    });
  }

  function destroyTrackers() {
    liveTrackers.forEach(function (tracker) {
      tracker.destroy();
    });
    liveTrackers = [];
  }

  function elementTracked(el) {
    var result = false;
    util.forEachAttr(editTrackers, function (TrackerClass) {
      if (TrackerClass.tracked(el)) {
        result = true;
      }
    });
    return result;
  }

  function startOrionTracking(model) {
    var tracker = new OrionEditor(model);
    ot.simpleHistorySingleton = ot.SimpleHistory(session.clientId, tracker.getContent(), 1);
    liveTrackers.push(tracker);
  }

  function getOrionTracker() {
    for (var i=0; i<liveTrackers.length; i++) {
      var tracker = liveTrackers[i];
      if (tracker.trackerName == "OrionEditor") {
        //FIXME: assert statement below throws an exception when data is submitted to the hub too fast
        //in other words, name == tracker.trackerName instead of name == tracker when someone types too fast in the tracked editor
        //commenting out this assert statement solves the problem
        // assert((! name) || name == tracker.trackerName, "Expected to map to a tracker type", name, "but got", tracker.trackerName);
        return tracker;
      }
    }
    return null;
  }

  function getTracker(el, name) {
    el = $(el)[0];
    for (var i=0; i<liveTrackers.length; i++) {
      var tracker = liveTrackers[i];
      if (tracker.tracked(el)) {
        //FIXME: assert statement below throws an exception when data is submitted to the hub too fast
        //in other words, name == tracker.trackerName instead of name == tracker when someone types too fast in the tracked editor
        //commenting out this assert statement solves the problem
        assert((! name) || name == tracker.trackerName, "Expected to map to a tracker type", name, "but got", tracker.trackerName);
        return tracker;
      }
    }
    return null;
  }

  var TEXT_TYPES = (
    "color date datetime datetime-local email " +
        "tel text time week").split(/ /g);

  function isText(el) {
    el = $(el);
    var tag = el.prop("tagName");
    var type = (el.prop("type") || "text").toLowerCase();
    if (tag == "TEXTAREA") {
      return true;
    }
    if (tag == "INPUT" && TEXT_TYPES.indexOf(type) != -1) {
      return true;
    }
    return false;
  }

  function getValue(el) {
    el = $(el);
    if (isCheckable(el)) {
      return el.prop("checked");
    } else {
      return el.val();
    }
  }

  function getElementType(el) {
    el = $(el)[0];
    if (el.tagName == "TEXTAREA") {
      return "textarea";
    }
    if (el.tagName == "SELECT") {
      return "select";
    }
    if (el.tagName == "INPUT") {
      return (el.getAttribute("type") || "text").toLowerCase();
    }
    return "?";
  }

  function setValue(el, value) {
    el = $(el);
    var changed = false;
    if (isCheckable(el)) {
      var checked = !! el.prop("checked");
      value = !! value;
      if (checked != value) {
        changed = true;
        el.prop("checked", value);
      }
    } else {
      if (el.val() != value) {
        changed = true;
        el.val(value);
      }
    }
    if (changed) {
      eventMaker.fireChange(el);
    }
  }

  /* Send the top of this history queue, if it hasn't been already sent. */
  function maybeSendUpdate(element, history, tracker) {
    var change = history.getNextToSend();
    if (! change) {
      /* nothing to send */
      return;
    }
    var msg = {
      type: "form-update",
      element: element,
      "server-echo": true,
      replace: {
        id: change.id,
        basis: change.basis,
        delta: {
          start: change.delta.start,
          del: change.delta.del,
          text: change.delta.text
        }
      }
    };
    if (tracker) {
      msg.tracker = tracker;
    }
    session.send(msg);
  }

    session.hub.on("request-init-content", function (msg) {
        console.log("initcontent requested!!!");
        if (! msg.sameUrl) {
          return;
        } else {
            sendInit(msg.peer.id);
        }
    });

    session.hub.on("init-content", function (msg) {
        if (! msg.sameUrl || msg.requestorID !== session.clientId) {
          return;
        }
        if (initSent) {
          // In a 3+-peer situation more than one client may init; in this case
          // we're probably the other peer, and not the peer that needs the init
          // A quick check to see if we should init...
          var myAge = Date.now() - TogetherJS.pageLoaded;
          if (msg.pageAge < myAge) {
            // We've been around longer than the other person...
            return;
          }
        }
        // FIXME: need to figure out when to ignore inits
        msg.updates.forEach(function (update) {
            inRemoteUpdate = true;
            try {
              if (update.tracker) {
                var tracker = getOrionTracker();
                assert(tracker);
                tracker.init(update.value, msg);
              } else {
                setValue(el, update.value);
              }
              if (update.basis) {
                var history = ot.simpleHistorySingleton;
                // don't overwrite history if we're already up to date
                // (we might have outstanding queued changes we don't want to lose)
                if (!(history && history.basis === update.basis &&
                      // if history.basis is 1, the form could have lingering
                      // edits from before togetherjs was launched.  that's too bad,
                      // we need to erase them to resynchronize with the peer
                      // we just asked to join.
                      history.basis !== 1)) {
                  ot.simpleHistorySingleton = ot.SimpleHistory(session.clientId, update.value.text, update.basis);
                }
              }
            } finally {
              session.received_initContent = true;
              inRemoteUpdate = false;
            }
        });
    });

  queueWhileInit = [];

  session.hub.on("form-update", function (msg) {
    if (! msg.sameUrl) {
      return;
    }

    var upd = function(msg) {
        var tracker;

        if (msg.tracker) {
          tracker = getOrionTracker();
          assert(tracker);
        }
        var value;
        if (msg.replace) {
          var history = ot.simpleHistorySingleton;
          if (!history) {
            console.warn("form update received for uninitialized form element");
            return;
          }
          var trackerName = null;
          if (typeof tracker != "undefined") {
            trackerName = tracker.trackerName;
          }

          // make a real TextReplace object.
          msg.replace.delta = ot.TextReplace(msg.replace.delta.start,
                                             msg.replace.delta.del,
                                             msg.replace.delta.text);
          // apply this change to the history
          var curr = history.current;
          var changed = history.commit(msg.replace);

          maybeSendUpdate(msg.element, history, trackerName);
          if (! changed) {
            return;
          }
          // value = history.current;
        } else {
          value = msg.value;
        }
        inRemoteUpdate = true;
        try {
          if(tracker) {
            delta = ot.TextReplace.fromChange(curr, typeof value == 'undefined' ? history.current : value);
            tracker.setContent({msg: delta});
            // tracker.update({text: history.current});
          }
        } finally {
          inRemoteUpdate = false;
        }
    }

    /*
    * if the session hasn't been initialized yet,
    * push the new changes into the queue.
    * Once the session has been initialized, clear the queue by applying all changes,
    * and then process the current change.
    */
    if (session.isClient && !session.received_initContent) {
        console.log("received change while initializing");
        queueWhileInit.push(msg);
        return;
    } else if (queueWhileInit.length > 0) {
        while (queueWhileInit.length > 0){
            if (queueWhileInit[0].replace.basis < ot.simpleHistorySingleton.basis) {
                queueWhileInit.shift();
            } else {
                upd(queueWhileInit.shift());
            }
        }
    }

    upd(msg);
  });

  var initSent = false;

  function sendInit(requestorId) {
    initSent = true;
    var msg = {
      type: "init-content",
      pageAge: Date.now() - TogetherJS.pageLoaded,
      updates: [],
      requestorID: requestorId
    };
    var tracker = getOrionTracker();
    var init = tracker.makeInit();
    assert(tracker);
    var history = ot.simpleHistorySingleton;
    if (history) {
        init.value.text = history.committed;
        init.basis = history.basis;
    }
    msg.updates.push(init);

    if (msg.updates.length) {
      session.send(msg);
    }
  }

  function setInit() {
    destroyTrackers();
    //be ready to receive the textModel
    document.addEventListener("modelHere", modelReceived);
    //Ask for the textModel
    var event = new CustomEvent("modelNeeded", {"detail": {"msg": " "}});
    document.dispatchEvent(event);
    //reinitialize trackers
    // buildTrackers();
    window.setInterval(function() {}, 1000);
  }

  function buildUI() {
    var sideMenuList = document.getElementById('sideMenu').childNodes[2];
    if (typeof sideMenuList == 'undefined') {
        return;
    } else {
        for (i=0; i < 10; i++){
            var listItem = document.createElement('li'); //$NON-NLS-0$
            listItem.classList.add("sideMenuItem"); //$NON-NLS-0$
            listItem.classList.add("sideMenu-notification"); //$NON-NLS-0$
            var anchor = document.createElement("a"); //$NON-NLS-0$
            anchor.classList.add("submenu-trigger"); // styling
            var img = document.createElement("img");
            img.width = "16";
            img.height = "16";
            img.src = "https://worldvectorlogo.com/logos/eclipse-11.svg";
            anchor.appendChild(img);
            listItem.appendChild(anchor);
            sideMenuList.appendChild(listItem);
        }
    }
  }

  /*
   * Is called when the textModel is received, now we can start tracking.
  */
  function modelReceived(e) {
    startOrionTracking(e.detail.model);
    requestLineInit();
  }

  function requestLineInit() {
    //get the line positions of all peers
    var msg  = {
        type: 'request-line'
    };

    session.send(msg);
  }

  session.on("reinitialize", setInit);

  session.on("ui-ready", setInit);

  session.on("close", destroyTrackers);

  var lastFocus = null;

  session.on("ui-ready", function () {
    $(window).on("beforeunload", session.close);
  });

  session.on("close", function () {
    $(window).off("beforeunload", session.close);
  });

  session.hub.on("hello", function (msg) {
    if (msg.sameUrl) {
      setTimeout(function () {
        if (lastFocus) {
          session.send({type: "form-focus", element: elementFinder.elementLocation(lastFocus)});
        }
      });
    }
  });

  return forms;
});
