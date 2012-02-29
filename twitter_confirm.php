<?php
include 'twitter-async/EpiCurl.php';
include 'twitter-async/EpiOAuth.php';
include 'twitter-async/EpiTwitter.php';
include 'twitter_secret.php';

$twitterObj = new EpiTwitter($consumer_key, $consumer_secret);

/* Will contain the status message to send to the client
   ('twitter.authenticated', 'twitter.auth_failed' etc.) */
$message = '';

try
{
  $twitterObj->setToken($_GET['oauth_token']);
  $token = $twitterObj->getAccessToken();
  $twitterObj->setToken($token->oauth_token, $token->oauth_token_secret);

  setcookie('twitter_token', $token->oauth_token);
  setcookie('twitter_token_secret', $token->oauth_token_secret);
    
  $message = "twitter.authenticated";
} catch (EpiTwitterNotAuthorizedException $e) {
  $message = 'twitter.not_authorized';
} catch (EpiOAuthUnauthorizedException $e) {
  $message = 'twitter.auth_failed';
} catch (Exception $e) {
  $message = 'twitter.auth_error';
}
?>
<!DOCTYPE html>
<html>
  <head>
    <script>
      <?
        if ($message == 'twitter.authenticated') { ?>
        
      localStorage.setItem('auth.twitter.token', '<?= $token->oauth_token ?>');
      localStorage.setItem('auth.twitter.token.secret', '<?= $token->oauth_token_secret ?>');
      
        <?
        }
        ?>


      if (window.opener)
        window.opener.postMessage('<?= $message ?>', '*');

    </script>
  </head
  <body>
    OK
  </body>
</html>