<?php
  /* Trampoline requests to the Twitter REST API. */
  include 'twitter-async/EpiCurl.php';
  include 'twitter-async/EpiOAuth.php';
  include 'twitter-async/EpiTwitter.php';
  include 'twitter_secret.php';

  header('Content-Type: application/json');

  $oauth_token = $_COOKIE['twitter_token'];
  $oauth_token_secret = $_COOKIE['twitter_token_secret'];
  
  $req_method = $_SERVER['REQUEST_METHOD'];
  
  $param_array = null;
  if ($req_method == 'GET') {
    $param_array = $_GET;
  } 
  else if ($req_method == 'POST') {
    $param_array = $_POST;
  }
  
  $turl = $param_array['t_url'];
  $twt_url = urldecode($turl);
  
  $twitterObj = new EpiTwitter($consumer_key, $consumer_secret, $oauth_token, $oauth_token_secret);
  
  // Lets see if this works...
  $method = strtolower($req_method);
  
  if ($method === 'post') {
    unset($param_array['t_url']);
  }
  
  try
  {
    $twitterResult = $twitterObj->$method($turl, $param_array);
    print($twitterResult->responseText);
  } catch (EpiTwitterNotAuthorizedException $e) {
    print('{ "j_error" : "not authenticated" }');
  } catch (EpiOAuthUnauthorizedException $e) {
    print('{ "j_error" : "not authenticated" }');
  } catch (Exception $e) {
    $m = $e->getMessage();
    print('{ "j_error" : "');
    print($m);
    print('" }');
  }
?>