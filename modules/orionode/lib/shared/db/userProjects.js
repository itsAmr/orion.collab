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
	args = require('../../args');

function userProjectJSON(username) {
	return {
		username: username,
		sharedProjects: []
	};
}

mongoose.Promise = Promise;

module.exports = function(options) {
    var workspaceRoot = options.options.workspaceDir;
    if (!workspaceRoot) { throw new Error('options.options.workspaceDir path required'); }

	var sharedUtil = require('../sharedUtil');
	var projectsCollection = require('./sharedProjects');
	var path = require('path');

	var app = express.Router();
	module.exports.getUserSharedProjects = getUserSharedProjects;

	var userProjectsSchema = new mongoose.Schema({
		username: {
			type: String,
			unique: true,
			required: true
		},
		sharedProjects : [String] //or ObjectId for reference?
	});
	
	var userProject = mongoose.model('userProject', userProjectsSchema);
	if (!mongoose.connection.readyState) {
		mongoose.connect('mongodb://localhost/orion_multitenant');
	}

	app.use(bodyParser.json());
	app.use(bodyParser.urlencoded({ extended: false }));
	app.use(cookieParser());
	app.use(expressSession({
		resave: false,
		saveUninitialized: false,
		secret: 'keyboard cat',
		store: new MongoStore({ mongooseConnection: mongoose.connection })
	}));
	
	/**START OF HELPER FUNCTIONS**/

	/**
	 * adds user if not exists.
	 */
	function addUser(username) {
		return userProject.findOne({'username': username}).exec()
		.then(function(doc) {
			if (!doc) {
				return userProject.create(userProjectJSON(username));
			}
			return new Promise.resolve(doc);
		});
	}
	
	/**
	 * Adds project to user's shared projects.
	 */
	function addProjectToUser(user, projectpath) {
		var project = projectsCollection.getProjectRoot(projectpath);
		return addUser(user)
		.then(function(doc) {
			return userProject.findOneAndUpdate({username: user}, {$addToSet: {'sharedProjects': project} }).exec();
		});
	}
	
	/**
	 * Removes a project from a user's shared projects.
	 */
	function removeProjectFromUser(user, projectpath) {
		var project = projectsCollection.getProjectRoot(projectpath);

		return userProject.findOneAndUpdate({username: user}, {$pull: {'sharedProjects': { $in: [project]}} });
	}
	
	/**
	 * Removes all references from project (project made private by user).
	 * Should take object Id rather than path? As should everything else?
	 */
	function removeProjectReferences(projectpath) {
		
	}

	/**
	 * returns a list of projects shared to the user.
	 */
	function getUserSharedProjects(user) {
		// var query = userProject.findOne({'username': user});
		// query.select('sharedProjects');
		// query.exec()
		return userProject.findOne({'username': user}, 'sharedProjects')
		.then(function(doc) {
			var projects = doc.sharedProjects;
			projects = projects.map(function(project) {
				var name = path.win32.basename(project);
				return {'Name': name, 'Location': project};
			});
			return projects;
		});
	}
	
	/**END OF HELPER FUNCTIONS**/
	
	app.post('/', function(req, res) {

	});
	
	/**
	 * Adds a project to a user's shared project list.
	 */
	app.post('/addProjectUser', function(req, res) {
		//TODO make sure project has been shared first.
		var project = req.body.project;
		var user = req.body.username;
		project = path.join(workspaceRoot, req.user.workspace, project);
		
		if (!sharedUtil.projectExists(project)) {
			throw new Error("Project does not exist");
		}

		addProjectToUser(user, project)
		.then(function(result) {
			res.end();
		});
	});
	
	/**
	 * Removes a project from a user's shared project list.
	 * Project might have been deleted or just user removed from shared list.
	 */
	app.delete('/removeProjectUser', function(req, res) {
		var project = req.body.project;
		var user = req.body.username;
		project = path.join(workspaceRoot, req.user.workspace, project);

		removeProjectFromUser(user, project)
		.then(function(result) {
			res.end();
		});
	});
	
	return app;
};