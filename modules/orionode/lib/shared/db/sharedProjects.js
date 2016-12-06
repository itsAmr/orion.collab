/*******************************************************************************
 * Copyright (c) 2016 IBM Corporation and others.
 * All rights reserved. This program and the accompanying materials are made 
 * available under the terms of the Eclipse Public License v1.0 
 * (http://www.eclipse.org/legal/epl-v10.html), and the Eclipse Distribution 
 * License v1.0 (http://www.eclipse.org/org/documents/edl-v10.html). 
 *
 * Contributors:
 *	 IBM Corporation - initial API and implementation
 *******************************************************************************/
/*eslint-env node*/

var express = require('express'),
	expressSession = require('express-session'),
	MongoStore = require('connect-mongo')(expressSession),
	passport = require('passport'),
	cookieParser = require('cookie-parser'),
	bodyParser = require('body-parser'),
	mongoose = require('mongoose'),
	Promise = require('bluebird'),
	fs = require('fs'),
	args = require('../../args'),
	sharedUtil = require('../sharedUtil');
	
function projectJSON(project) {
	return {
		Location: project.projectpath,
        HubID: project.hubid,
        Owner: project.username
	};
}

mongoose.Promise = Promise;

module.exports = function(options) {
    var workspaceRoot = options.options.workspaceDir;
    if (!workspaceRoot) { throw new Error('options.options.workspaceDir path required'); }

	var app = express.Router();
	module.exports.getHubID = getHubID;
	module.exports.getProjectPathFromHubID = getProjectPathFromHubID;

	var sharedProjectsSchema = new mongoose.Schema({
		location: {
            type: String,
            unique: true,
            required: true
        },
        hubid: {
            type: String,
            unique: true,
            required: true
        },
        owner: {
			type: String
		},
	});
	
	var orionAccount = mongoose.model('sharedProject', sharedProjectsSchema);
	// if (!mongoose.connection.readyState) {
	// 	mongoose.connect('mongodb://localhost/orion_multitenant');
	// }
	
	//verify the following
	// app.use(bodyParser.json());
	// app.use(bodyParser.urlencoded({ extended: false }));
	// app.use(cookieParser());
	// app.use(expressSession({
	// 	resave: false,
	// 	saveUninitialized: false,
	// 	secret: 'keyboard cat',
	// 	store: new MongoStore({ mongooseConnection: mongoose.connection })
	// }));
	// app.use(passport.initialize());
	// app.use(passport.session());
	
	/*********************************/
	/**
	 * Returns true if the user owns the project,
	 * and therefore is allowed to share/unshare it.
	 */
	function isProjectOwner(user, projectpath) {
		
	}

	/**
	 * Adds the project and a new hubID to the sharedProjects db document.
	 */
	function addProject(projectpath) {
		proj = getProjectRoot(projectpath);
		hub = generateUniqueHubId();
		//TODO
		return proj + hub;
	}

	/**
	 * Removes project from shared projects.
	 * Also removes all references from the other table.
	 */
	function removeProject(projectpath) {
		return projectpath;
	}
	
	/**
	 * For example if the project is renamed.
	 */
	function updateProject(projectpath, data) {
		return projectpath;
	}
	
	/**
	 * returns a unique hubID
	 */
	function generateUniqueHubId() {
		length = 10;
  		var letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUV0123456789';
		var s = '';
		for (var i=0; i<length; i++) {
			s += letters.charAt(Math.floor(Math.random() * letters.length));
		}
		return s;
	}
	
    function getHubID(filepath) {
		var projs = {
			'\\mo\\mourad\\OrionContent\\potato': '0123456789',
			'\\mo\\mourad\\OrionContent\\level1': '890721397120',
			'\\mo\\mourad\\OrionContent\\web': '12838901273'
		}
        var project = getProjectRoot(filepath);
        //return db.findHub(project)
		var ans = projs[project];
        return Promise.resolve(ans);
    }


	/**
	* returns the project path associated with the given hib id (if exists)
	**/
	function getProjectPathFromHubID(id) {
		var projs = {
			'0123456789': '\\mo\\mourad\\OrionContent\\potato',
			'890721397120': '\\mo\\mourad\\OrionContent\\level1',
			'12838901273': '\\mo\\mourad\\OrionContent\\web'
		}
		var ans = projs[id];
		return Promise.resolve(ans);
	}

    /**
     * Removes the root server workspace, and trailing file tree within project.
     * Example:
     * input: "C:\Users\IBM_ADMIN\node.workspace\mo\mourad\OrionContent\web\hello.html"
     * return: "\mo\mourad\OrionContent\web" which is the unique project path format that can be found in the database.
     */
    function getProjectRoot(filepath) {
        var index = filepath.indexOf(workspaceRoot);
        if (index == -1) throw new Error('The project is not in the correct server.');
        index += workspaceRoot.length;
        filepath = filepath.substring(index);
        return filepath.split("\\").slice(0,5).join("\\");
    }

	/*********************************/
	app.get('/', function(req, res) {
		res.end();
	});

	app.post('/shareProject', function(req, res) {
		var project = req.params["0"];
		project = req.user.workspaceDir + project;
		if (!sharedUtil.projectExists(project)) {
			throw new Error("Project does not exist");
		}

		addProject(project);
	});

	app.delete('/unshareProject', function(req, res) {
		var project = req.params["0"];
		project = req.user.workspaceDir + project;
		if (!sharedUtil.projectExists(project)) {
			throw new Error("Project does not exist");
		}

		removeProject(project);
	});

	app.post('/logout', function(req, res){
		req.logout();
		res.end();
	});
	
	app.post('/login/form', function(req, res, next) {
		passport.authenticate('local', function(err, user, info) {
			if (err) { 
				return next(err);  
			}
			if (!user) {
				return res.status(401).json({error: info.message});
			}
			req.logIn(user, function(err) {
				if (err) { return next(err); }
				user.login_timestamp = new Date();
				user.save(function(err){
					if (err) {
					}
					return res.status(200).end();
				});
			});
		})(req, res, next);
	});

	function checkUserAccess(req, res, next) {
		if (!req.user || !(req.params.id === req.user.username || isAdmin(req.user.username))) {
			return res.status(403).end();
		}
		next();
	}

	app.get("/users", checkUserAccess, function(req,res){
		orionAccount.find({}, function(err, users) {
			if (err) {
				return res.status(404).end();
			}
			var start = Math.min(users.length, Math.max(0, Number(req.query.start)) || 0);
			var rows = Math.min(users.length, Math.max(0, Number(req.query.rows)) || 20);
			var end = start + rows;
			var result = [];
			for (var i=start; i<end; i++) {
				result.push(userJSON(users[i]));
			}
			return res.status(200).json({
				Users: result,
				UsersStart: start,
				UsersRows: rows,
				UsersLength: users.length
			});
		});
	});

	app.get("/users/:id", checkUserAccess, function(req,res){
		orionAccount.findByUsername(req.params.id, function(err, user) {
			if (err) return res.status(404).end();
			if (!user) {
				res.writeHead(400, "User not fount: " + req.params.id);
				return res.end();
			}
			return res.status(200).json(userJSON(user));
		});
	});

	app.put("/users/:id", checkUserAccess, function(req,res){
		orionAccount.findByUsername(req.params.id, function(err, user) {
			if (err) return res.status(404).end();
			if (!user) {
				res.writeHead(400, "User not fount: " + req.params.id);
				return res.end();
			}
			var hasNewPassword = typeof req.body.Password !== "undefined";
			// users other than admin have to know the old password to set a new one
			if (!isAdmin(req.params.id)) {
				//TODO
			}
			if (typeof req.body.UserName !== "undefined") user.username = req.body.UserName;
			if (typeof req.body.FullName !== "undefined") user.fullname = req.body.FullName;
			if (typeof req.body.Email !== "undefined") user.email = req.body.Email;
			if (typeof req.body.OAuth !== "undefined") user.oauth = req.body.OAuth;
			function save(err) {
				if (err) res.writeHead(400, "Failed to update: " + req.params.id);
				return res.status(200).end();
			}
			if (hasNewPassword) {
				user.setPassword(req.body.Password, function(err, user) {
					if (err) res.writeHead(400, "Failed to update: " + req.params.id);
					user.save(save);
				});
			} else {
				user.save(save);
			}
		});
	});

	app.delete("/users/:id", checkUserAccess, function(req,res){
		orionAccount.remove({username: req.params.id}, function(err) {
			if (err) return res.status(400).end();
			return res.status(200).end();
		});
	});

	app.post("/users/:id", checkUserAccess, function(req,res){
		orionAccount.findByUsername(req.params.id, function(err, user) {
			if (err) return res.status(404).end();
			if (!user) {
				res.writeHead(400, "User not fount: " + req.params.id);
				return res.end();
			}
			user.setPassword(req.body.Password, function(err, user) {
				if (err) res.writeHead(400, "Failed to update: " + req.params.id);
				user.save(function save(err) {
					if (err) res.writeHead(400, "Failed to update: " + req.params.id);
					return res.status(200).end();
				});
			});
		});
	});

	function createUserDir(user, callback) {
		var workspacePath = [options.workspaceDir, user.username.substring(0,2), user.username, "OrionContent"];
		var localPath = workspacePath.slice(1).join("/");
		args.createDirs(workspacePath, function(err) {
			if (err) {
				//do something
			}
			user.workspace = localPath;
			user.save(function(err) {
				if (err) throw err;
				callback(null, localPath);
			});
		});
	}

	app.post('/users', function(req, res){
		// If there are admin accounts, only admin accounts can create users
		if (options.configParams["orion.auth.user.creation"] && !isAdmin(req.user && req.user.username)) {
			return res.status(403).end();
		}
		orionAccount.register(new orionAccount({username: req.body.UserName, email: req.body.Email, fullname: req.body.FullName, oauth: req.body.identifier}), req.body.Password ,function(err, user){
			if (err) {
				return res.status(404).json({Message: err.message});
			}
			if (options.configParams["orion.auth.user.creation.force.email"]) {
				sendMail({user: user, options: options, template: CONFIRM_MAIL, auth: CONFIRM_MAIL_AUTH, req: req});
			} else {
				user.isAuthenticated = true;
				createUserDir(user, function(err) {
					if (err) {
						//log
					}
				});
			}
			return res.status(201).json({error: "Created"});
		});
	});

	//auth token verify
	app.get('/useremailconfirmation/verifyEmail', function(req,res){
		var authToken = req.query.authToken;
		orionAccount.verifyEmail(authToken, function(err, user) {
			if (err) {
				//log
			}
			createUserDir(user, function(err) {
				if (err) {
					//log
				}
				return res.status(200).send("<html><body><p>Your email address has been confirmed. Thank you! <a href=\"" + ( req.protocol + '://' + req.get('host'))
				+ "\">Click here</a> to continue and login to your account.</p></body></html>");
			});
		});
	});

	app.get('/useremailconfirmation/resetPwd', function(req,res){
		var authToken = req.query.authToken;
		orionAccount.verifyEmail(authToken, function(err, user) {
			if (err) {
				//log
			}
			//generate pwd
			var password = generator.generate({
				length: 8,
				numbers: true,
				excludeSimilarCharacters:true
			});
			user.setPassword(password, function(err, user) {
				user.save(function(err){
					if (err) {
						//log
					}
					sendMail({user: user, options: options, template: PWD_RESET_MAIL, auth: "", req: req, pwd: password});
					return res.status(200).send("<html><body><p>Your password has been successfully reset. Your new password has been sent to the email address associated with your account.</p></body></html>");
				});
			});
		});
	});

	app.post("/useremailconfirmation/cansendemails", /* @callback */ function(req, res){
		res.status(200).json({EmailConfigured: !!options.configParams["mail.smtp.host"]});
	});

	app.post('/useremailconfirmation', function(req, res){
		var resetPwd = function(err, user) {
			if (err || !user) {
				res.writeHead(404, "User " +  (req.body.UserName || req.body.Email) + " not found");
				return res.end();
			}
			if (!user.isAuthenticated){
				res.writeHead(400, "Email confirmation has not completed. Please follow the instructions from the confirmation email in your inbox and then request a password reset again.");
				return res.end();
			}
			user.setAuthToken(function (err, user){
				user.save(function(err){
					sendMail({user: user, options: options, template: PWD_CONFIRM_RESET_MAIL, auth: RESET_PWD_AUTH, req: req});
					return res.status(200).json({"Severity":"Info","Message":"Confirmation email has been sent.","HttpCode":200,"BundleId":"org.eclipse.orion.server.core","Code":0});
				});
			});
		};
		if (req.body.UserName) {
			orionAccount.findByUsername(req.body.UserName, resetPwd);
		} else if (req.body.Email) {
			orionAccount.find({email: req.body.Email}, function(err, user) {resetPwd(err, user[0]);});
		}
	});

	app.post('/login/canaddusers', /* @callback */ function(req, res) {
		return res.status(200).json({
			CanAddUsers: canAddUsers(), 
			ForceEmail: !!options.configParams["orion.auth.user.creation.force.email"], 
			RegistrationURI:options.configParams["orion.auth.registration.uri"] || undefined});
	});
	
	app.post('/login', function(req, res) {
		if (!req.user) {
			return res.status(200).end();
		}
		return res.status(200).json(userJSON(req.user));
	});
	
	return app;
};