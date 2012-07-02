(function() {
  var twitter = J.GetNamespace('J.Twitter');
  
  twitter.DefaultProxyPath = '/twitter/tramp.php';

  // Represents an authenticated connection to the Twitter REST API.
  // To communicate with the REST API you must be running a proxy at the
  // path 'proxy_path' on whichever server served this file.
  // If 'proxy_path' is no supplied then it defaults to 'twitter/tramp/php'
  //
  // I.e. your server should be running at http://<somehost>/twitter/tramp.php
  twitter.Connection = function(proxy_path) {
    // The proxy to use...
    this._proxy_path = proxy_path || J.Twitter.DefaultProxyPath;
    
    // The notification center to use
    this._notifications = J.Notifications || J.CreateNotificationCenter();
    
    // We need to notice when a user has authenticated
    this._notifications.Subscribe('j.twitter.authenticated', jQuery.proxy(this, 'CheckForAccount'));
    
    // ViewModel for this connection
    this.ViewModel = {
      User : ko.observable({}),
      Error : ko.observable(""),
      Home : ko.observableArray(),
      Mentions : ko.observableArray(),
      Messages : ko.observableArray(),
      SelectedTweets : ko.observableArray()
    };
    
    this.__did_tweet = $.proxy(this, '_did_tweet');
    this.__have_account = $.proxy(this, '_have_account');
    this.__have_home_timeline = $.proxy(this, '_have_home_timeline');
    this.__have_messages = $.proxy(this, '_have_messages');
    this.__have_mentions = $.proxy(this, '_have_mentions');
  };

  
  twitter.Connection.prototype = {
    Init: function() {
    },
    
    // Callthe Twitter REST API.
    // You must at least supply a REST API url as the first parameter.
    // You may then optionally supply:
    //  - An object containing request data for the http request
    //  - A string specifying the type of the HTTP request ('GET', 'POST' etc.)
    //  - A callback function to call when the request is complete. THe callback
    //    will be provided with an object representing the JSON result of the call
    Api: function() {
      if (arguments.length === 0)
        return;
        
      var url = arguments[0];
      if (J.IsNonEmptyString(url) === false) {
        console.warn('J.Twitter.Connection.Api: Provide a REST API url as the first parameter');
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
          console.warn('J.Twitter.Connection.Api: "t_url" is reserved for internal use when sending POST request to Twitter (you must rename this field in your POST data)');
          return;
        }
      } else {
        data = {};
      }
        
      data.t_url = url;
      data.include_entities = true;
      
      
      // Construct the proxy URL from the protocol and host of the current page
      // and the path supplied in the constructor
      var loc  =  window.location;
      var tramp_url = [
        loc.protocol,
        "//",
        loc.host,
        this._proxy_path
      ].join('');

      $.ajax({
        url : tramp_url,
        type: method,
        data: data,
        context: this,
        success: callback,
        error: (function(req, status, exn) { callback({ j_error : ('' + status + ': ' + exn) }); }),
        cache: false
      });

    },
    
    
    // Convert the random Ruby string that Twitter gives us into a
    // sensible date
    _sanitise_date: function(tweet) {
      if (tweet.hasOwnProperty('created_at') === false)
        return;
      
      var t_date = tweet.created_at;
      tweet._j_created_at = new Date(t_date).toJSON();
    },

    
    // Ordering used when sorting a tweet entity - we sort
    // be ascending first character index...
    _entity_order_fn: function(entity) {
      if (!entity || !entity.hasOwnProperty('indices') || entity.indices.length < 1)
        return 0;

      
      return entity.indices[0];
    },


    // construct an html representation of a tweet's text - i.e.
    // make the links live, maybe show any embedded pictures...
    //   'item': the tweet we are examining
    //   'entities' : the entities from 'item' that have been processed
    //                and sorted by the functionsn below...
    // The function sets the property '_j_html_text' on 'item' to the
    // HTML markup representing the tweet content
    _construct_html: function(tweet, entities) {
      if (tweet.hasOwnProperty('text') === false) {
        tweet['_j_html_text'] = "";
        return; // tweet has no text??
      }

      if (!entities  || entities.length === 0) {
        tweet['_j_html_text'] = tweet.text;
      }

      // Collect the string chunks constituting the HTML representation here
      var chunks = [];

      var source_text = tweet.text;
    
          

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
      
      
        etype = entity["_j_etype"];
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
            
            if (size !== null) {
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
      
      
      tweet["_j_html_text"] = chunks.join('');
    },

    
    // Process all the entities on the item 'item',
    // tagging each entity with the type of entity it is
    // (url, user mention etc), then constructing an html
    // string representing the tweet with the entities linked
    _process_tweet: function(tweet) {
      if (!tweet.hasOwnProperty('entities'))
        return;
      
      var entities = tweet.entities;
      var all = [];
      var ctr;
      
      var e, l;
      if (entities.hasOwnProperty('user_mentions')) {
        e = entities.user_mentions;
        l = e.length;
        
        for (ctr = 0; ctr < l; ++ctr) {
          e[ctr]["_j_etype"] = "bbl-user-mention";
          all.push(e[ctr]);
        }
      }
      
      if (entities.hasOwnProperty('urls')) {
        e = entities.urls;
        l = e.length;
        
        for (ctr = 0; ctr < l; ++ctr) {
          e[ctr]["_j_etype"] = "bbl-url";
          all.push(e[ctr]);
        }
      }
      
      if (entities.hasOwnProperty('hashtags')) {
        e = entities.hashtags;
        l = e.length;
        for (ctr = 0; ctr < l; ++ctr) {
          e[ctr]["_j_etype"] = 'bbl-hashtag';
          all.push(e[ctr]);
        }
      }
      
      var sorted = J.CountSortObjects(all, this._entity_order_fn);
      
      this._construct_html(tweet, sorted);
    },


    // An async call to the proxy has come back with an error
    _handle_twitter_error: function(twitter_result) {
      var j_error = twitter_result['j_error'];
      if (j_error !== undefined) {
        if (j_error === 'not authenticated') {
            this._notifications.Notify('j.twitter.not_authenticated');
        } else {
            console.error('Twitter error: ' + j_error);
            this.ViewModel.Error(j_error);
        }
      } else {
        this._notifications.Notify('j.twitter.error', this, 'unknown error');
      }
    },

    // Retrieved the current Twitter user's account...
    _have_account: function(account){
      if (account.hasOwnProperty('j_error')) {
        this._handle_twitter_error(account);
        return;
      }
      
      this.ViewModel.User(account);
      
      this._notifications.Notify('j.twitter.have_user', this, account);
    },


    // Async result from a Tweet
    _did_tweet: function(new_tweet) {
      if (new_tweet.hasOwnProperty('j_error')) {
        this._handle_twitter_error(new_tweet);
        return;
      }
      
      
      // Process the Tweet's entities nad generate the HTML representation
      this._process_tweet(tweet);

      // 'Unshift' pushes an item onto the start of an array...
      this.ViewModel.Home.unshift(new_tweet);
    },

    _process_timeline: function(timeline, vm_field) {
      vm_field.removeAll();
      
      if (timeline.hasOwnProperty('j_error')) {
        this._handle_twitter_error(timeline);
        return;
      }
      
      for (var ctr = timeline.length - 1; ctr >= 0; ctr--){
        this._process_tweet(timeline[ctr]);
        this._sanitise_date(timeline[ctr]);
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
      vm_field.splice.apply(vm_field, timeline);
    },

    // Async result from a home timeline get...
    _have_home_timeline: function(timeline){
      this._process_timeline(timeline, this.ViewModel.Home);

      this._notifications.Notify('j.twitter.have_timeline', this, timeline);
    },


    _have_messages: function(messages) {
      this._process_timeline(messages, this.ViewModel.Messages);
      this._notifications.Notify('j.twitter.have_messages', this, messages);
    },


    _have_mentions: function(mentions) {
      this._process_timeline(mentions, this.ViewModel.Mentions);

      this._notifications.Notify('j.twitter.have_mentions', this, mentions);
    },


    // Check if there's an authenticated Twitter account
    CheckForAccount: function(){
      this.Api('/account/verify_credentials.json', this.__have_account);
    },

    // Send a tweet
    //   'text' : the text of the tweet
    //   'reply_to' : the ID of any tweet we are replying to
    //                leave null or unset of this is not a reply
    Tweet : function(text, reply_to) {
      if (!text) {
        console.warn("Twitter.Tweet: No text in tweet!");
        return;
      }
       
      var data = { status: text };
      if (reply_to) {
        data.in_reply_to_status_id = '' + reply_to;
      }

      // TODO: attachments...
      this.Api('/statuses/update.json', 'POST', data, this.__did_tweet);
    },
      
    // Retweet a tweet
    //   'tweet_id' : the ID of the tweet to retweet
    Retweet : function(tweet_id) {
      if (!tweet_id) {
        console.warn("Tweet.Retweet: No tweet ID supplied!");
        return;
      }
        
      var url = [ '/statuses/retweet/', tweet_id, '.json'].join('');
       
      this.Api(url, 'POST', this.__did_tweet);
    },

    // Get the user's home timeline
    RefreshHomeTimeline: function() {
      this.Api('/statuses/home_timeline.json', this.__have_home_timeline);
    },


    // Get the user's mentions
    RefreshMessages: function() {
      this.Api('/direct_messages.json', this.__have_messages);
    },
    
    
    RefreshMentions: function() {
      this.Api('/statuses/mentions.json', this.__have_mentions);
    },
    

    // Refresh everything...
    Refresh: function() {
      this.RefreshHomeTimeline();
      this.RefreshMessages();
      this.RefreshMentions();
    },
    
    
    SelectTweets: function(tweets, accum) {
      var selected_tweets = this.ViewModel.SelectedTweets;
      if (accum === false)
        selected_tweets.removeAll();


      for (var ctr = 0; ctr < tweets.length; ++ctr) {
         selected_tweets.push(tweets[ctr]);
      }
    }
  };
  
  
  // This singleton AuthManager handles the oauth procedure to authenticate
  // against Twitter without having to reload the current window. We open a
  // new window, have the user authernticate, and use a postMessage call to
  // supply the authentication tokens to the original window.
  twitter.AuthManager = (function() {
    // We only want to receive messages posted form the same origin
    var _origin = window.location.protocol + '//' + window.location.host;
    // Ugh...
    var _www_origin = window.location.protocol + '//www.' + window.location.host;
    
    // The window containing the Twitter authentication UI
    var _auth_window = null;
    
    // The function called when we detect a window.postMessage
    var _authFinishedListener = function(e) {
      if (e.origin === _origin || e.origin === _www_origin) {
        var msg = e.data;
        
        console.log(msg);
        
        if (msg === 'twitter.authenticated') {
          // Twitter authenticated OK
          var twitter_token = localStorage.getItem('auth.twitter.token');
          var twitter_token_secret = localStorage.getItem('auth.twitter.token.secret');
          
          
          
          if (J.Notifications)
            J.Notifications.Notify('j.twitter.authenticated', this, null);
          
        }
        else if ((msg === 'twitter.not_authenticated') || (msg === 'twitter.auth_failed')) {
          // User cancelled or couldn't get the right password...
          J.Notifications.Notify('j.twitter.not_authenticated');
        }
        else if (msg === 'twitter.auth_error')
        {
          J.Notifications.Notify('j.twitter.auth_error', this, null);
        } else {
          console.warn('Unexpected message from Twitter authentication: ' + msg);
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
        J.Notifications.Notify('j.twitter.authenticating');
      

      _auth_window = window.open(authentication_url);
    };
    
    
    return {
      StartAuthentication: _start_auth
    };
    
  }());


  twitter.IsAuthenticator = (function() {
    var _auth_dialogs = $();
    var _progress_panels = $();
    
    J.Notifications.Subscribe('j.twitter.authenticating',
      function() {
        _auth_dialogs.addClass('j-authenticating');
      }
    );
    
    J.Notifications.Subscribe('j.twitter.authenticated',
      function() {
        _auth_dialogs.removeClass('j-authenticating').removeClass('j-unauthenticated').addClass('j-authenticated');
      }
    );
    
    var _notAuthenticated = function() {
      _auth_dialogs.removeClass('j-authenticating').removeClass('j-authenticating').addClass('j-unauthenticated');
    };

    J.Notifications.Subscribe('j.twitter.auth_failed',
      function() {
        _notAuthenticated();
        _auth_dialogs.addClass('j-errored');
      }
    );
    
    J.Notifications.Subscribe('j.twitter.not_authenticated', _notAuthenticated);
    
    var _doAuth = function(e) {
      var el = $(e.currentTarget);
      var auth_url = el.attr('data-auth-url') || J.Twitter.DefaultAuthUrl;
      if (!auth_url) {
        console.warn('J.Twitter.IsAuthenticator: Cannot find authorisation URL');
        return;
      }
      
      J.Twitter.AuthManager.StartAuthentication(auth_url);
    };


    return function(panel) {
      if (J.IsJQuery(panel) === false) {
        console.log('J.Twitter.IsAuthenticator: panel provided should be a jQuery object');
        return;
      }
      
      _auth_dialogs.add(panel);
      panel.find('.j-twt-login').click(_doAuth);
    };
    
  }());
  
  twitter.Instance = new twitter.Connection();
}());