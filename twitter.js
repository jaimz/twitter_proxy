(function() {
  Twitter = J.CreateNamespace('J.Comm.Twitter');


  // Represents a proxy to the Twitter REST API, this client-side
  // class talks to a server-side counterpart at 'proxy_url' which, in turn,
  // talks to the actual REST API.
  Twitter.Proxy = function(proxy_url) {
    // The location of the proxy to the Twitter REST API...
    this._proxy_url = proxy_url || "http://www.thebitflow.com/twitter/tramp.php";
    
    // The notification center to use
    this._notifications = J.Notifications || J.CreateNotificationCenter();

    // We need to notice if a user has authenticated
    var auth_listener = jQuery.proxy(function() { this.CheckForAccount() }, this);
    this._notifications.Subscribe('j.twitter.did_auth', auth_listener);


    // TODO: Should tag accumulation be in this object?
    this._tag_collection = {};
    this._tag_id_map = {};


    
    // The Knockout ViewModel that represent the current
    // Twitter data...
    this._view_model = {
      User : ko.observable({}),
      Home : ko.observableArray(),
      Entities : ko.observable([]), 
      EntityIds : ko.observable({}), // This is rubbish - sort out tags
      SelectedTweets : ko.observableArray(),
      Error : ko.observable("")
    };
  };
  
  Twitter.Proxy.prototype = (function() {
    // POS lexer for collecting tags
    var _lexer = new Lexer();
    
    // POS tagger for collecting, err, tags
    var _tagger = new POSTagger();


    // An async call to the proxy has come back with an error
    var _handle_twitter_error = function(obj, self) {
      var ctx = self || this;
      var j_error = obj['j_error'];
      if (j_error !== undefined) {
        switch (j_error) {
        case 'not authenticated':
          ctx._notifications.Notify('j.twitter.not_authenticated');
          break;
        default:
          console.error(j_error);
          ctx._view_model.Error(j_error);
          ctx._notifications.Notify('j.twitter.error', this, j_error);
          break;
        }
      } else {
        // TODO: this
        ctx._notifications.Notify('j.twitter.error', this, 'unknown error');
      }
    };


    // Add the given tag to the current collection,
    // 'id' is the str_id of the tweet containing the tag
    var _add_tag_to_collection = function(self, tag, id) {
      if (tag.length < 2)
        return;
      
      if (this._tag_collection.hasOwnProperty(tag))
        self._tag_collection[tag] = this._tag_collection[tag] + 1;
      else
        self._tag_collection[tag] = 1;
      
      if (_tag_id_map.hasOwnProperty(tag))
        self._tag_id_map[tag].push(id);
      else
        self._tag_id_map[tag] = [ id ];
    };


    // Collect tags from the given item collection (usually a user's tiemline)
    var _collect_tags = function(self, items) {
      self._tag_collection = null;
      self._tag_id_map = null;

      if (!items || !items.length)
        return;


      var l = items.length;
      var text, words, tags;
      var idx = 0;
      var curr = [];
      var currTag, currNoun, tagCount;
      for (var ctr = 0; ctr < l; ++ctr) {
        text = items[ctr].text;
        if (!text)
          continue;
              
        words = _lexer.lex(text);
        if (words.length === 0)
          continue;
              
        tags = _tagger.tag(words);
            
        idx = 0;
        curr = [];
        tagCount = tags.length;
        while (idx < tagCount) {
          if (tags[idx][1] === 'NNP') {
            curr.push(tags[idx][0]);
          } else {
            if (curr.length > 0) {
              _add_tag_to_collection(curr.join(' '), items[ctr].id_str);
              curr = [];
            }
          }
              
          idx += 1;
        }
      }
    };

    
    // ordering function used when sorting tweet entity - we
    // sort by ascending first character index...
    var _get_entity_order = function(entity) {
      if (!entity || !entity.hasOwnProperty('indices') || entity.indices.length < 1) {
        //DEBUG: 
        console.warn('problem getting entity order: ');
        console.log(entity);
        return 0;
      }
      
      return entity.indices[0];
    };
    

    // construct an hmtl representation of a tweet's text - i.e. 
    // make the links live, maybe show any embedded pictures...
    //   'item': the tweet we are examining
    //   'entities' : the entities from 'item' that have been processed
    //                and sorted by the functionsn below...
    // The function sets the property '_j_html_text' on 'item' to the
    // HTML markup representing the tweet content
    var _construct_html = function(item, entities) {
      if (item.hasOwnProperty('text') === false) {
        item['_j_html_text'] = "";
        return; // tweet has no text??
      }

      if (!entities  || entities.length === 0) {
        item['_j_html_text'] = item.text;
      }

      // Collect the string chunks constituting the HTML representation here
      var chunks = [];

      var source_text = item.text;
    
      // DEBUG
      //console.log('\n\nSRC: ' + source_text);
    

      var l = entities.length;
      var cut_from = 0;
      var cut_to = 0;
      var cut_len = 0;
      
      var entity = null;
      var etype = null;
      for (var e_ctr = 0; e_ctr < l; ++e_ctr) {
        entity = entities[e_ctr];
        
        cut_to = entity.indices[0];
        cut_len = cut_to - cut_from;
        
        if (cut_len > 0) {
          //DEBUG:
          //console.log('('+cut_from+', ' + cut_to + '): ' + source_text.substring(cut_from, cut_to));
          chunks.push(source_text.substring(cut_from, cut_to));
        }
        
        
        cut_from = cut_to;
        cut_to = entity.indices[1];
        cut_len = cut_to - cut_from;
      
      
        var etype = entity["_j_etype"];
        var href = '#';
        switch (etype) {
        case 'bbl-user-mention':
          href = 'http://www.twitter.com/#!/' + entity["screen_name"];
          break;
        case 'bbl-hashtag':
          href = 'http://www.twitter.com/#!/' + encodeURIComponent(entity["text"]);
          break;
        case 'bbl-url':
          href = entity["expanded_url"];
          break;
        case 'bbl-linked-pic':
          href = entity["expanded_url"];
          break;
        default:
          href = '#';
          break;
        }
        
        chunks.push("<a href='");
        chunks.push(href);
        chunks.push("' class='");
        chunks.push(etype);
        chunks.push("'");
        
        if (etype === "bbl-linked-pic") {
          chunks.push("data-pic-url='");
          chunks.push(entity["media_url"]);
          chunks.push("'");
          
          var sizes = entity.sizes;
          var size = null;
          if (sizes !== undefined) {
            if (sizes.large !== undefined) { size = sizes.large; }
            else if (sizes.medium !== undefined) { size = sizes.medium; }
            else if (sizes.small !== undefined) { size = sizes.small; }
            
            if (size != null) {
              chunks.push('data-pic-w="');
              chunks.push(size.w);
              chunks.push('"');
              
              chunks.push('data-pic-h="');
              chunks.push(size.h);
              chunks.push('"');
            }
          }
        }
        chunks.push(">");
      
        
        if (cut_len > 0) {
          //DEBUG:
          //console.log('('+cut_from+', '+cut_to+'): '+source_text.substring(cut_from, cut_to))
          chunks.push(source_text.substring(cut_from, cut_to));
        }
        chunks.push("</a>");
      
        
        cut_from = cut_to;
      }
      
      if (source_text.length > cut_from) {
        // DEBUG:
        //console.log('REM: ('+cut_from+', '+source_text.length+'): '+source_text.substring(cut_from, source_text.length));
        chunks.push(source_text.substring(cut_from, source_text.length));    
      }
      
      
      item["_j_html_text"] = chunks.join('');
    };

    
    // Process all the entities on the item 'item',
    // tagging each entity with the type of entity it is 
    // (url, user mention etc), then constructing an html
    // string representing the tweet with the entities linked
    var _process_entities = function(item) {
      if (!item.hasOwnProperty('entities'))
        return;
      
      var entities = item.entities;
      var all = [];
      
      var e, l;
      if (entities.hasOwnProperty('user_mentions')) {
        e = entities.user_mentions;
        l = e.length;
        
        for (var ctr = 0; ctr < l; ++ctr) {
          e[ctr]["_j_etype"] = "bbl-user-mention";
          all.push(e[ctr]);
        }
      }
      
      if (entities.hasOwnProperty('urls')) {
        e = entities.urls;
        l = e.length;
        
        for (var ctr = 0; ctr < l; ++ctr) {
          e[ctr]["_j_etype"] = "bbl-url";
          all.push(e[ctr]);
        }
      }
      
      if (entities.hasOwnProperty('hashtags')) {
        e = entities.hashtags;
        l = e.length;
        for (var ctr = 0; ctr < l; ++ctr) {
          e[ctr]["_j_etype"] = 'bbl-hashtag';
          all.push(e[ctr]);
        }
      }
      
      var sorted = J.CountSortObjects(all, _get_entity_order);
      
      _construct_html(item, sorted);
    };

    
    // Called when we have issued a new tweet
    var _did_tweet = function(new_tweet) {
      if (new_tweet.hasOwnProperty('j_error')) {
        _handle_twitter_error(new_tweet, this);
        return;
      }
    

      _process_entities(new_tweet);
      // The wonderfully logical 'unshift' pushes an 
      // item onto the start of an array.
      this._view_model.Home.unshift(new_tweet);
    };


    // Called when we have received a home timeline update for
    // the current account
    var _have_home_timeline = function(timeline) {
      this._view_model.Home.removeAll();

      if (timeline.hasOwnProperty('j_error')) {
        this._handle_twitter_error(timeline, this);
        return;
      }
      
   
      var len = timeline.length;
      for (var ctr = 0; ctr < len; ++ctr) {
        _process_entities(timeline[ctr]);
      }
      

      // OK... we need to call array.splice to append all the new items
      // to our existing (observable) array, but we have to call it indirectly via
      // Function.apply since splice takes individual parameters, not an array.
      // Finally, we have to prepend 0,0 to the new array (using the wonderfully
      // logical "unshift" method) because the first two parameters to splice are 
      // the index to splice into and the number of elements to remove.
      //
      // Javascript is awesome...
      timeline.unshift(0,0);
      this._view_model.Home.splice.apply(this._view_model.Home, timeline);
    

      _collect_tags(timeline);
      var entities = J.SortObject(this._tag_collection);
      this._view_model.Entities(entities);
      this._view_model.EntityIds(this._tag_id_map);

      // Send a notification separate to the view-model
      this._notifications.Notify('j.twitter.have_timeline', this, timeline);
    };


    // Called when we have checked for an authenticated user account
    var _have_account = function(account) {
      if (account.hasOwnProperty('j_error')) {
        _handle_twitter_error(account, this);
        return;
      } 

      this._view_model.User(account);
      
      this._notifications.Notify('j.twitter.have_user');
    };
    

    
    return {
      GetViewModel : function() { return this._view_model; },
      
      // Call the Twitter REST api.
      // You must at least supply a REST API url as the first parameter.
      // You may then optionally supply:
      //   - An object contining request data for the http request
      //   - A string specifying th etype of http request ('GET', 'POST' etc)
      //   - A callback function to call when the request is completed. The 
      //     callback will be provided with an object representing the JSON
      //     result of the call...
      Api : function() {
        if (arguments.length === 0)
          return;
        
        var url = arguments[0];
        if (typeof(url) !== 'string') {
          console.warn('First argument to J.Twitter.Api must be a string');
          return;
        }
        
        
        var optional = Array.prototype.splice.call(arguments, 1);
        var data = null;
        var method = 'GET';
        var callback = null;
        var l = optional.length;
        var curr, t;
        
        for (var ctr = 0; ctr < l; ++ctr) {
          curr = optional[ctr];
          t = typeof(curr);
          
          if (t === 'object')
            data = curr;
          else if (t === 'string')
            method = curr;
          else if (t === 'function')
            callback = curr;
        }
        
        method = method || "GET";
        
        
        if (data !== null) {
          if (data.hasOwnProperty('t_url')) {
            console.warn('J.Twitter: t_url is reserved for internal use when sending POST request to Twitter (you must rename this field in your POST data)');
            return;
          }
        } else {
          data = {};
        }
        
        data.t_url = url;
        data.include_entities = true;
        
        var loc = window.location;
        var tramp_url = [
          loc.protocol,
          "//",
          loc.host,
          "/twitter/tramp.php"
        ].join('');
        
        $.ajax({
          url : tramp_url,
          type: method,
          data: data,
          context: this,
          success: callback,
          error: (function(req, status, exn) { callback({ j_error : ('' + status + ': ' + exn) }) }),
          cache: false
        });
      },

      // Send a tweet
      //   'text' : the text of the tweet
      //   'reply_to' : the ID of any tweet we are replying to
      //                leave null or unset of this is not a reply
      Tweet : function(text, reply_to) {
        if (!text) {
          console.warn("Twitter.Tweet: No text in tweet!");
          return;
        };
        
        var data = { status: text };
        if (reply_to) {
          data.in_reply_to_status_id = '' + reply_to;
        }

        // TODO: attachments...
        this.Api('/statuses/update.json', 'POST', data, _did_tweet);
      },
      
      // Retweet a tweet
      //   'tweet_id' : the ID of the tweet to retweet
      Retweet : function(tweet_id) {
        if (!tweet_id) {
          console.warn("Tweet.Retweet: No tweet ID supplied!");
          return;
        }
        
        var url = [ '/statuses/retweet/', tweet_id, '.json'].join('');
        
        this.Api(url, 'POST', _did_tweet);
      },


      // Update the home timeline for the current account
      UpdateHomeTimeline : function() {
        this.Api('/statuses/home_timeline.json', _have_home_timeline);
      },


      // See if we have an authenticated twitter accound and fill
      // in the view-model if we do...
      CheckForAccount : function() {
        this.Api('/account/verify_credentials.json', _have_account);
      },

      // Select the tweet with the id_str 'id_str', if you want
      // this tweet to be selected in addition to the current selection(s)
      // then set accu to true
      SelectTweet : function(id_str, accu) {
        var ids = id_str.split(',');
        var to_show = [];
        
        var curr = this._view_model.SelectedTweets();
        var curr_len = curr.length;
        var id_len = ids.length;
        var id_to_check = null;
        var contained = false
        
        for (var id_ctr = 0; id_ctr < id_len; ++id_ctr) {
          id_to_check = ids[id_ctr];
          
          for (var ctr = 0; ctr < curr_len; ++ctr) {
            if (curr[ctr].id_str === id_to_check) {
              contained = true;
              break;
            }
          }
          
          if (!contained)
            to_show.push(id_to_check);
        }
        
        if (to_show.length === 0)
          return;
        
        
        
        var tweets = [];
        var tl = this._view_model.Home();
        var l = tl.length;
        var ts_len = to_show.length;
        
        
        for (id_ctr = 0; id_ctr < ts_len; ++id_ctr) {
          id_to_check = to_show[id_ctr];
          
          for (var ctr = 0; ctr < l; ++ctr) {
            if (tl[ctr].id_str === id_to_check) {
              tweets.push(tl[ctr]);
              break;
            }
          }
        }
        
        var tweets_len = tweets.length;
        if (tweets_len !== to_show.length)
          console.warn('Could not find all the tweets we are supposed to show');
        
    
        if (!accu)
          this._view_model.SelectedTweets.removeAll();
        
        for (ctr = 0; ctr < tweets_len; ++ctr) {
          this._view_model.SelectedTweets.push(tweets[ctr]);
        }
      }
    };
  }());

  
  // This singleton AuthManager handles the oauth procedure to authenticate
  // against Twitter without having to reload the current window. We open a
  // new window, have the user authernticate, and user a postMessage call to 
  // supply the authentication tokens to the original window.
  Twitter.AuthManager = (function() {

    // We only want to receive message posted from the same origin
    var _origin = window.location.protocol+"//"+window.location.host;
    
    // Ugh...
    var _www_origin = window.location.protocol+"//www."+window.location.host;
    

    // The window that will contain the authentication UI from the third party
    var _auth_window = null;
    

    // The function called when we detect a window.postMessage
    var _authFinishedListener = function(e) {
      //console.log('eo: '+e.origin+', o: '+_origin+'m: '+e.data);
      
      if (e.origin === _origin || e.origin === _www_origin) {
        var msg = e.data;
        if (msg === 'twitter.authenticated') {
          // Twitter authenticated OK
          var twitter_token = localStorage.getItem('auth.twitter.token');
          var twitter_token_secret = localStorage.getItem('auth.twitter.token.secret');
          
          
          
          if (J.Notifications)
            J.Notifications.Notify('j.twitter.did_auth', this, null);
          
        }
        else if (msg === 'twitter.auth_failed' || msg === 'twitter.not_authenticated') {
          if (J.Notifications)
            J.Notifications.Notify('j.twitter.did_fail_auth', this, null);
        }
        else if (msg === 'twitter.auth_error')
        {
          if (J.Notifications)
            J.Notifications.Notify('j.twitter.auth_errored', this, null);

          console.warn('Twitter OAuth authentication errored');
        } else {
          console.warn('Unexpected message from Twitter authentication');
        }
            
        if (_auth_window !== null) {
          _auth_window.close();
          _auth_window = null;
        }

      }
    };
    
    window.addEventListener('message', _authFinishedListener);
    
    
    // Begin the authentication process.
    var _start_auth = function(authentication_url) {
      if (_auth_window !== null)
        return; // authentication already in progress
      
      
      if (J.Notifications)
        J.Notifications.Notify('j.twitter.will_authenticate');
      

      _auth_window = window.open(authentication_url);
    };
    
    
    return {
      StartAuthentication: _start_auth
    };

  }());

  
  // Instantiate a UI for triggering Twitter OAuth authentication.
  // We use OAuth for Twitter login, the authentication URL can either be
  // supplied to this function - HasTwitterAuth(el, 'http://....') - or
  // be defined in the global TwitterAuthUrl
  Twitter.AuthUI = function(el, auth_url) {
    if (el === null || el.length === undefined || el.length === 0) {
      console.warn('Unexpected root element passed to Twitter.AuthUI - should be a jQuery object');
      return;
    }
    
    this._authentication_url = auth_url || TwitterAuthUrl;
    if (this._authentication_url === undefined) {
      console.warn('Twitter.AuthUI: could not find authentication URL');
      return;
    }

    this.el = el;
    this.login_buttons = el.find('.j-twt-login');


    var _did_auth = jQuery.proxy(this, "DidAuth");
    var _did_deauth = jQuery.proxy(this, "DidDeauth");
    var _did_fail_auth = jQuery.proxy(this, "DidFailAuth");
    var _do_auth = jQuery.proxy(this, "DoAuth");
    
    this.login_buttons.on('click', _do_auth);


    var nots = J.Notifications;
    if (nots) {
      nots.Subscribe('j.twitter.did_auth', _did_auth);
      nots.Subscribe('j.twitter.did_fail_auth', _did_fail_auth);
      nots.Subscribe('j.twitter.did_deauth', _did_deauth);
    }    
  };

  
  Twitter.AuthUI.prototype = {
    DidAuth : function() {
      this.el.removeClass('j-not-authd');
      this.el.removeClass('j-authenticating');
      this.el.addClass('j-authenticated');
    },

    
    DidFailAuth : function() {
      this.el.removeClass('j-authenticating');
      this.el.addClass('j-auth-errored');    
    },


    DidDeauth : function() {
      this.el.removeClass('j-authenticating');
      this.el.removeClass('j-authenticated');
      this.el.addClass('j-unauthenticated');
    },


    DoAuth : function() {
      if (!J.Comm.Twitter.AuthManager) {
        console.warn('Could not find twitter authentication manager');
        return;
      }
      
      J.Comm.Twitter.AuthManager.StartAuthentication(this._authentication_url);
    }
  };


  // Namespace-wide collection of Twitter authorisation UIs - for when
  // client code doesn't really need to keep a handle on the UIs itself
  Twitter.HasAuth = (function() {
    var _authers = [];
    
    return (function(el) {
      var auther = new Twitter.AuthUI(el);
      _authers.push(auther);
    });
  }());
  
                     
  Twitter.Default = new Twitter.Proxy();
  
}());