Elephant Grass
===================
Elephant Grass is an open-source Gmail script that requests Bitcoin payments from unknown email senders.  If the sender pays you, their email makes it to your inbox.

Releases
-------------

2015-12-07 - [Elephant Grass v0.6](https://docs.google.com/spreadsheets/d/1_Qdl81gUV13enJTgM27TfnWmkZKMVKMN74lL-RpOzwI/copy?usp=sharing)

  * bug fix: don't autoreply to autoreplies or google notifications 
  * bug fix: retry Bitcoin address generation whenever address returned by BC.i is not unique
  * bug fix: continue processing emails that need to be archived even if outgoing email quota reached 
  * bug fix: fixed issue where "Autoreply Limit Days" config option was sometimes not respected if there were multiple unread messages in the inbox from the same sender
  * more friendly default autoreply template
  * new feature: make payment requests optional with new config option "Request Payments"
  * new feature: ability to disable autoreplies by blanking out config option "Autoreply Template"
  * new feature: include original sender's message in autoreply, see config option "Autoreply Quote Message"
  * new feature: star emails that receive payment, see config option "Star Paid Emails"
  * new feature: send 2nd autoreply when a payment is received, see config options "Autoreply When Paid" and "Autoreply When Paid Template"

2015-06-05 - [Elephant Grass v0.5](https://docs.google.com/spreadsheets/d/1Ffn7O5y7iElzmRbj4LzVx4SMHpcyKK7NVi_RaJxoF2c/copy?usp=sharing)

  * bug fix: don't autoreply to messages that have been manually replied to by user
  * bug fix: autoreply to first sender in a thread, not last
  * bug fix: archive/label emails that don't require an autoreply even if outgoing daily email limit has been reached

2015-06-02 - [Elephant Grass v0.4](https://docs.google.com/a/elephantgrass.io/spreadsheets/d/1Xa0okYVmjOwn14dxFqoDh39aczD7loYdB6MJQht9igo/copy?usp=sharing)
  
  * initial release

How To Install
-------------
1. Login to your Google account.
2. Click the most recent release link above to copy the Elephant Grass spreadsheet and script to your Google Drive.
3. Open the spreadsheet.  The config options for the script will be displayed on the first sheet.  Put your Bitcoin address in the **Value column** on the **Bitcoin Address** row.  Modify any other config options (these can be changed later at anytime).
4. On the spreadsheet's menu, click **Run > Process Inbox + Check For Payments**.  Click **Accept** to authorize the script when prompted.

This will execute a first run of the script and, by default, will scan your inbox and spam folder for unread mail from unknown senders, and autoreply to each with one a payment request.  Additionally, this will setup the script to be run automatically every 1 minute - even if you're not logged into your Google account.

How To Upgrade To The Latest Version
-------------
If you've already copied Elephant Grass to your Google Drive and run it, follow these steps to upgrade to the latest version: 

1. Login to your Google account.
2. Open your current Elephant Grass spreadsheet.
3. On the spreadsheet's menu, click **Run > Stop Running Automatically**.  This will prevent this old spreadsheet from processing your inbox concurrently with the new version.
4. Copy the new version of the Elephant Grass spreadsheet to your Google Drive using the link above.
5. Open the **new version** of the Elephant Grass spreadsheet, and click **Run > Import Data Spreadsheet Data**. Click **Accept** to authorize the script when prompted.
6. When the file picker dialog opens, select the **old** version of your Elephant Grass spreadsheet and click **Select**.  This will import all of your data and settings into the new Elephant Grass version.
7. In the **new version**, click **Run > Process Inbox + Check For Payments** to process your inbox and kick off automatic processing.

The old version of Elephant Grass can now be optionally deleted from your Google Drive.

How It Works
-------------
Elephant Grass is a Google Apps Script that's bound to a custom Google Spreadsheet. By default, the script runs once per minute in the background, even if you're not logged with your Google account.

On each run, it performs the following:

1. Adds all of your contacts to a whitelist on the spreadsheet.  Emails from whitelisted senders are ignored, and are never autoreplied to with a payment request.
2. Scans your inbox and spam folder for unread messages.  If the sender is not whitelisted, they are sent an autoreply payment request containing a unique Bitcoin address and payment amount.  The email is then given a "payment pending" label and moved from your inbox to the archive.
3. Checks for payments made on outstanding payment requests.  If a payment was made, the sender's original email(s) are moved back to your inbox and given a "payment complete" label.  The sender is then added to the greylist.
4. If a sender has made enough payments, they are automatically moved from the greylist to the whitelist.
5. If too many payment requests have gone unpaid by a sender, they are moved to a blacklist.  Email from senders on the blacklist are always moved to the archive and never labeled or autoreplied to.

The script has a bunch of configuration options including amount of Bitcoin to request and which emails to search and process.  These options can be specified on the spreadsheet's config sheet.  All data pertaining to the script's operations are also stored in separate sheets on the spreadsheet.

Important Notices
-------------
  * If you have over 100 emails from different senders in your inbox, you may want to move them out of your inbox before running Elephant Grass.  Google limits Gmail users to sending to at most [100 different recipients per day](https://developers.google.com/apps-script/guides/services/quotas).  Elephant Grass will process as many emails as it can, but you may see some errors in the **log** sheet if Google's limits are exceeded.

The Spreadsheet
-------------
The spreadsheet acts as the configuration, database, and log for the script.  Below are descriptions of what's in the individual sheets.

##### config
The configuration of Elephant Grass.  You can modify how the script works by entering custom values for the config options in the **Values** column.  These config options are read by the script on each run, so you can change them at any time.

There's a hidden column to right of the **Values** column that acts the key names for options.  Don't mess with this column.

##### lists
Lists of emails that have been categorized by the script.  You can manually add, remove, or edit any email in these lists too.

  * **whitelist** - emails from these senders will never be touched, autoreplied, or moved out of your inbox.  These addresses are sync'd from your contacts list on each run.
  * **greylist** - email addresses of senders who've been autoreplied to and have made payments.  These senders will still be autoreplied to if a certain number of days of have passed since the last email you've received from them (see the **Autoreply Limit Days** config options).  See also the **Move Sender on Greylist to Whitelist After X Payments** config option.
  * **blacklist** - senders who you want to ignore.  Their emails will always be archived, and never autoreplied to.  See the **Blacklist Sender After X Expired Payments** config option.

If an email address happens to show up in any two lists at the same time, the Elephant Grass script will automatically remove the duplicate email from the darker list.

##### bounced
A list of emails that have been labeled as "payment pending" and moved to the archive, and optionally autoreplied to.  Rows that have a **Bitcoin address** and a **Bounced** date have been autoreplied to.  Rows that do not are emails from senders who've already been autoreplied in response to a prior email.

When a payment is made on an email, its row is moved to the **paid** sheet.  When an email's payment expires, its row is deleted.

All datetimes are UTC.

##### paid
A list of emails that have been paid by the original sender.  These are copied over from the **bounced** sheet on payment.

All datetimes are UTC.

##### expired
Tracks email addresses and how many expired payments they've had.

When a sender becomes blacklisted due to the **Blacklist Sender After X Expired Payments** config option, they are removed from this sheet.

##### log
The log of Elephant Grass's operations. Each row represents a run.  When a run starts, a new row is inserted with an ID and a Started datetime.  When the run completes, the remaining row's cells are populated.

The log can be disabled with the **Log** config option, and its max rows limited using the **Log Max Rows** config option.

All datetimes are UTC.

##### otherdata
This houses a JSON string of a data object in a single cell.  Currently it only contains two pieces of info: version and the Bitcoin balances last checked datetime.

FAQ
-------------

#### Why should I trust this script with access to my Gmail account?
You shouldn't. It's strongly suggested that you first test and verify it with a throwaway email account before using it on a real email account.  It's pretty easy to do:

1. Create a throwaway Gmail account.
2. Fill up its inbox with email from various senders using a service like [guerrillamail.com](https://www.guerrillamail.com) or [mailbait.info](http://mailbait.info) (not affiliated in anyway).
3. Optionally add/create some fake contacts.
4. Install Elephant Grass using the instructions above and let it run.
5. Optionally send Bitcoin payments on behalf of senders.  The addresses are available in the **bounced** sheet as well as your Gmail "Sent Mail". 
6. Verify the results. Unpaid emails from strangers get autoreplied, labeled, and archived. Paid emails get restored back to your inbox. Emails from your contacts will be left untouched.

Note that none of your email info or contacts info is shared with any other parties or services.  The script runs on Google's servers. The only info that gets passed to a 3rd party is your Bitcoin addresses: your main Bitcoin address is passed to blockchain.info to create forwarding addresses, and your forwarding addresses are passed to blockr.io for payment monitoring. 

You can manually inspect and edit the script code by opening the spreadsheet and clicking **Tools > Script Editor...**.

#### Why don't you release this as a Google add-on?
Google needs to approve add-ons before they can be published.  Also, Google add-ons are limited to running automatically [at most once per hour](https://developers.google.com/apps-script/guides/triggers/installable#time-driven_triggers).  These limitations ruled out publishing this project an add-on.

#### Why does this script need to run periodically?
To monitor your inbox. Google Apps scripting does not have a trigger that's fired when a new email arrives in your inbox.  The best that can be done is to periodically check for new email to process every 1 minute.

#### How does Elephant Grass get a different Bitcoin address for every autoreply?
Using [Blockchain.info's Receive API](https://blockchain.info/api/api_receive).  They generate a new Bitcoin address on your behalf and forward any funds it receives to your Bitcoin address.

#### How does Elephant Grass monitor Bitcoin addresses for payments?
Using [Blockr.io's address API](http://btc.blockr.io/documentation/api).  They've got a lightweight API for checking the balances of multiple addresses with confirmations support.

#### How do I stop the script from running automatically?
In the spreadsheet's menu, click **Run > Stop Running Automatically**.  You can also blank out the **Value** column of the **Run Automatically Every X Minutes** config option.

Or simply delete the Elephant Grass spreadsheet.

#### I'm seeing errors in the log like " Service invoked too many times for one day: email".  Is it broken?
No, this is normal if you have an inbox or spam folder with 100 more emails from different senders.  It means the script tried to autoreply to all those senders in less than 24 hours, which exceeds [Google's outgoing email quota for regular Gmail users](https://developers.google.com/apps-script/guides/services/quotas).  Elephant Grass will handle these errors gracefully, and continue to run automatically, processing and autoreplying to as many emails as Google will allow it to on each run.  Keep an eye on the **log** sheet to verify this.

#### I'm seeing errors in the log like " Service error: Spreadsheets".  Is it broken?
Probably not.  This is Google's generic error that occurs when a spreadsheet is running "too hot" (read from and written to too frequently), and Elephant Grass should recover from these errors.  But if you encounter this error, please copy/paste it from the log into a new Github issue.

#### Why are there all these seemingly arbitrary minimums/maximums for the config options?
Because Google Apps scripting has [a number of limitations](https://developers.google.com/apps-script/guides/services/quotas), including things like:

 * 6 minute execution cap for time-based trigger scripts
 * 1 hour per day execution cap for time-based trigger scripts
 * 100 email recipients per day

Because of these limitations, and the fact that Google Apps scripting operations are really slow, Elephant Grass has impose its own limitations so the it can tread carefully and run as efficiently as possible.

#### I think Elephant Grass stopped processing my inbox. There are no recent runs or errors in the log sheet. What gives?
It's possible that Elephant Grass can exceed the 1 hour per day script execution limit.  In this case, Google will block any subsequent runs of the script, and so no errors will be logged by the script.  

If this occurs, you'll receive an email notification from **apps-scripts-notifications@google.com** at some point informing you that the execution time limit has been reached.

Best thing to do is just wait until the time limit has expired.

Script failure notifications can be enabled/disabled by opening the spreadsheet and clicking **Tools > Script editor...**. Then in the script editor's menu, click **Resources > Current project's triggers...** and click the **notifications** link beneath **processInboxCheckPayments**.

#### If the script is running every minute, is it possible for two different runs to overlap and execute concurrently?
Elephant Grass makes use of [Lock Service](https://developers.google.com/apps-script/reference/lock/) to prevent this from happening.  So far in our testing, no concurrent runs have occurred.

#### Where did the 'Elephant Grass' name come from?
http://gatherer.wizards.com/Pages/Card/Details.aspx?printed=false&multiverseid=3661

#### Wouldn't it make more sense to release Elephant Grass as a Thunderbird/Mail.app/[insert email client here] plugin?
Maybe so! Then Elephant Grass certainly wouldn't be limited to Google's quotas.

However, this was an initial release targeting the Gmail web interface, since it is probably used by far more people.

> A Timbo White & @jespow collaboration

