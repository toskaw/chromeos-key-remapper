const Remapper = {};

// Acts as a middleman that accepts an chrome.input.ime event and
// feeds it to registered event listeners. First listener to register
// gets to handle the event first.
Remapper.EventHandler = function EventHandler() {
  this.listeners = []
};

Remapper.EventHandler.prototype.addListener = function(fn) {
  this.listeners.push(fn)
};

Remapper.EventHandler.prototype.handleEvent = function() {
  let handled = false;
  for (let listener of this.listeners) {
    handled = listener.apply(null, arguments);
    if (handled) break;
  }
  return handled;
};

// Array of events to hijack.
// see: https://developer.chrome.com/extensions/input_ime
Remapper.events = [
  'onActivate',
  'onDeactivated',
  'onFocus',
  'onBlur',
  'onInputContextUpdate',
  'onKeyEvent',
  'onCandidateClicked',
  'onMenuItemActivated',
  'onSurroundingTextChanged',
  'onReset'
//  'onCompositionBoundsChanged' // appears to be private
];

// Name must match what's in hijack.js
Remapper.hijack = {};

Remapper.events.forEach(function(event) {
  const handler = new Remapper.EventHandler()
  Remapper.hijack[event] = handler;
  // The entire plot hinges on this `addListener` call not being
  // picked up by hijack.js, because this extension is just another
  // ime to be composed together with fallback imes.
  chrome.input.ime[event].addListener(handler.handleEvent.bind(handler));
})

Remapper.Engine = function (keymap) {
  var contextId = -1;
  var lastFocusedWindowUrl = null;
  const debug = false;

  const urlBlacklist = [
    'chrome-extension://pnhechapfaindjhompbnflcldabbghjo/html/crosh.html'
  ];

  const nullKeyData = {
    'altKey': false,
    'ctrlKey': false,
    'shiftKey': false,
    'key': '',
    'code': ''
  };

  const sequencePrefixToKeyDataAttribute = {
    'C-': 'ctrlKey',
    'S-': 'shiftKey',
    'M-': 'altKey'
  }

  function keyDataToSequenceString(keyData) {
    var sequence = '';
    if (keyData.ctrlKey) {
      sequence += 'C-';
    }
    if (keyData.shiftKey) {
      sequence += 'S-';
    }
    if (keyData.altKey) {
      sequence += 'M-';
    }
    sequence += keyData.key;
    return sequence;
  }

  function sequenceStringToKeyData(sequence) {
    var keyData = {};
    sequence.split(/(C-|M-|S-)/).forEach(function(part) {
      if (part.length == 0) {
        return;
      }
      var booleanAttribute = sequencePrefixToKeyDataAttribute[part];
      if (booleanAttribute) {
        keyData[booleanAttribute] = true;
        return;
      }
      // TODO: validate part is valid as code
      // Note: allegedly, only the `code` matters when using the `sendKeyEvents` API.
      keyData.code = part;
    });
    return keyData;
  }

  // grab the last focused window's URL for blacklisting. note that there will
  // be a delay due to the API being async.
  this.handleFocus = function(context) {
    contextId = context.contextID;
    chrome.windows.getLastFocused({
      populate: true,
      windowTypes: ['popup', 'normal', 'panel', 'app', 'devtools']
    }, function(window) {
      if (window && window.tabs.length > 0) {
        lastFocusedWindowUrl = window.tabs[0].url;
      }
    });
  }

  this.handleKeyEvent = function(engineID, keyData) {
    if (keyData.type === "keydown") {
      if (debug) {
        console.log(keyData.type, keyData.key, keyData.code, keyData);
      }
    }

    if (keyData.extensionId && (keyData.extensionId === chrome.runtime.id)) {
      // already remapped, pass it through
      return false;
    }

    if (lastFocusedWindowUrl && urlBlacklist.indexOf(lastFocusedWindowUrl) !== -1) {
      // don't remap in blacklisted windows
      return false;
    }

    var handled = false;

    if (keyData.type === "keydown") {
      var encodedSequence = keyDataToSequenceString(keyData);

      // TODO: convert keymap to an object of {match: decodedSequences} for speed
      var activeMapping = keymap.find(function(candidate) {
        return encodedSequence === candidate.match;
      });

      if (activeMapping) {
        var newKeyData = activeMapping.emit.map(function(sequence) {
          var mappedKeyData = sequenceStringToKeyData(sequence);
          return Object.assign({}, keyData, nullKeyData, mappedKeyData);
        });
        chrome.input.ime.sendKeyEvents({"contextID": contextId, "keyData": newKeyData});
        handled = true;
      }
    }

    return handled;
  }
}

// bindings for emacs-like cursor movements.
// variable name must match what's referenced in main.js.
// TODO: better documentation on what values are accepted.
const keymap = [
  {'match': 'C-a', 'emit': ['Home']}, // cursor: beginning of line
  {'match': 'C-e', 'emit': ['End']}, // cursor: end of line
  {'match': 'C-M-a', 'emit': ['C-Home']}, // cursor: beginning of contents
  {'match': 'C-M-e', 'emit': ['C-End']}, // cursor: end of contents
  {'match': 'C-f', 'emit': ['ArrowRight']}, // cursor: forward one character
  {'match': 'C-b', 'emit': ['ArrowLeft']}, // cursor: back one character
  {'match': 'C-p', 'emit': ['ArrowUp']}, // cursor: previous line
  {'match': 'C-n', 'emit': ['ArrowDown']}, // cursor: next line
  {'match': 'C-k', 'emit': ['S-End', 'C-KeyX']}, // cursor: cut to end of line
  {'match': 'C-h', 'emit': ['Backspace']}, // cursor: backspace
  {'match': 'C-d', 'emit': ['Delete']}, // cursor: delete one char
  {'match': 'M-a', 'emit': ['C-KeyA']}, // C-a replacement: for select all
  {'match': 'M-b', 'emit': ['C-KeyB']}, // C-b replacement: for boldening text on paper
  {'match': 'M-n', 'emit': ['C-KeyN']}, // C-n replacement: for opening a new window
  {'match': 'M-k', 'emit': ['C-KeyK']}, // C-k replacement: for Slack channel switcher
  {'match': 'C-s', 'emit': ['C-KeyF']} // C-f replacement: for search
];


(function() {
  var remapper = new Remapper.Engine(keymap);
  Remapper.hijack.onFocus.addListener(remapper.handleFocus.bind(remapper));
  Remapper.hijack.onKeyEvent.addListener(remapper.handleKeyEvent.bind(remapper));
})();
