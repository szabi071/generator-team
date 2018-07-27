// This is the code that deals with TFS
const async = require('async');
const request = require('request');
const util = require('../app/utility');

function run(gen, callback) {
   "use strict";
   
   findOrCreateRepository(gen, function (e, repository) {
      if (e) {
         // To get the stacktrace run with the --debug built-in option when 
         // running the generator.
         gen.env.error(e.message);
      } 

      callback(e);
   });
}

function findOrCreateRepository(gen, callback) {
   "use strict";

   var token = util.encodePat(gen.pat);

   util.tryFindRepository(gen.tfs, gen.projectName, gen.applicationName, token, gen, function (error, obj) {
      if (error) {
         callback(error, null);
      } else {
         // The project was found.
         if (obj) {
            gen.log(`+ Found Repository`);
            callback(error, obj);
            return;
         }

         gen.log(`+ Creating ${gen.applicationName} repository`);

         var repository = {};

         // Create the project
         // Use series to issue the REST API to create the project,
         // wait for it to be created or fail, and get the final id.
         async.series([
            function (thisSeries) {
               createRepository(gen.tfs, gen.projectName, gen.applicationName, token, gen, function (err, repo) {
                  repository = repo;
                  thisSeries(err);
               });
            },
            function (thisSeries) {
               var status = '';

               // Wait for Team Services to report that the project was created.
               // Use whilst to keep calling the the REST API until the status is
               // either failed or succeeded.
               async.whilst(
                  function () { return status !== 'failed' && status !== 'succeeded'; },
                  function (finished) {
                     util.checkStatus(repository.url, token, gen, function (err, stat) {
                        status = stat.id == repository.id ? 'succeeded' : 'failed';
                        finished(err);
                     });
                  },
                  thisSeries
               );
            },
            function (thisSeries) {
               var options = util.addUserAgent({
                  method: 'GET',
                  headers: { 'cache-control': 'no-cache', 'authorization': `Basic ${token}` },
                  url: `${util.getFullURL(gen.tfs)}/${gen.projectName}/_apis/git/repositories/${gen.applicationName}`,
                  qs: { 'api-version': util.PROJECT_API_VERSION }
               });

               // Get the real id of the team project now that is exist.
               request(options, function (err, res, body) {
                  if (err) {
                     thisSeries(err);
                     return;
                  }

                  if (res.statusCode !== 200) {
                     gen.log.error('Unable to find newly created repository.');
                     thisSeries({ message: 'Unable to find newly created repository.' });
                     return;
                  }

                  var project = JSON.parse(body);
                  thisSeries(err, project);
               });
            }
         ], function (err, result) {
            // By the time I get there the series would have completed and
            // the first two entries in result would be null.  I only want
            // to return the team project and not the array because when we
            // find the team project if it already exist we only return the
            // team project.
            callback(err, result[2]);
         });
      }
   });
}

function createRepository(account, project, repository, token, gen, callback) {
   "use strict";

   var options = util.addUserAgent({
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Basic ${token}` },
      json: true,
      url: `${util.getFullURL(account)}/${project}/_apis/git/repositories`,
      qs: { 'api-version': util.PROJECT_API_VERSION },
      body: {
         name: repository
      }
   });

   request(options, function (err, res, body) {
      callback(err, body);
   });
}

module.exports = {
   // Exports the portions of the file we want to share with files that require 
   // it.

   run: run,
   findOrCreateRepository: findOrCreateRepository,
};