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

	var sharedUtil = require('../sharedUtil');
	var path = require('path');

	var app = express.Router();
	module.exports.getHubID = getHubID;
	module.exports.getProjectPathFromHubID = getProjectPathFromHubID;
	module.exports.getProjectRoot = getProjectRoot;

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
		}
	});
	
	var sharedProject = mongoose.model('sharedProject', sharedProjectsSchema);
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
	 * Returns true if the user owns the project,
	 * and therefore is allowed to share/unshare it.
	 *
	 * Not necessary since we append the user workspaceroot before taking project root.
	 */
	function isProjectOwner(user, projectpath) {
		//TODO
		return false;
	}

	/**
	 * Adds the project and a new hubID to the sharedProjects db document.
	 */
	function addProject(projectpath) {
		var proj = getProjectRoot(projectpath);
		var hub = generateUniqueHubId();
		//TODO Also add name of project owner? Replace by projectJSON all over the file.
		return sharedProject.create({location: proj, hubid: hub});
	}

	/**
	 * Removes project from shared projects.
	 * Also removes all references from the other table.
	 */
	function removeProject(projectpath) {
		var proj = getProjectRoot(projectpath);
		//TODO remove all references from userproject collection too
		return sharedProject.remove({location: proj});
	}
	
	/**
	 * For example if the project is renamed.
	 */
	function updateProject(projectpath, data) {
		//TODO
		return false;
	}
	
	/**
	 * returns a unique hubID
	 */
	function generateUniqueHubId() {
		//TODO ensure generated hub id is unique (not in db)
		// do {
		var length = 10;
		var letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUV0123456789';
		var s = '';
		for (var i=0; i<length; i++) {
			s += letters.charAt(Math.floor(Math.random() * letters.length));
		}
		// } while (s == 0); //TODO actually check in db for value existence

		return s;
	}
	
    function getHubID(filepath) {
        var project = getProjectRoot(filepath);

		var query = sharedProject.findOne({location: project}, 'hubid');
		return query.exec()
		.then(function(doc) {
			return doc ? doc.hubid : undefined;
		});
    }


	/**
	* returns the project path associated with the given hib id (if exists)
	**/
	function getProjectPathFromHubID(id) {
		var query = sharedProject.findOne({hubid: id}, 'location');
		return query.exec()
		.then(function(doc) {
			return doc ? doc.location : undefined;
		});
	}

    /**
     * Removes the root server workspace, and trailing file tree within project.
     * Example:
     * input: "C:\Users\IBM_ADMIN\node.workspace\mo\mourad\OrionContent\web\hello.html"
     * return: "\mo\mourad\OrionContent\web" which is the unique project path format that can be found in the database.
     */
    function getProjectRoot(filepath) {
        var index = filepath.indexOf(workspaceRoot);
        if (index === -1) throw new Error('The project is not in the correct server.');
        index += workspaceRoot.length;
        filepath = filepath.substring(index);
        return filepath.split("\\").slice(0,5).join("\\");
    }

	/**END OF HELPER FUNCTIONS**/

	app.get('/', function(req, res) {
		res.end();
	});

	/**
	 * req.body.project should be the project name.
	 */
	app.post('/shareProject', function(req, res) {
		var project = req.body.project;
		project = path.join(workspaceRoot, req.user.workspace, project);
		if (!sharedUtil.projectExists(project)) {
			throw new Error("Project does not exist");
		}

		//if add project was successful, return
		addProject(project)
		.then(function(result) {
			res.end();
		});
	});

	/**
	 * req.body.project should be the project name.
	 */
	app.delete('/unshareProject', function(req, res) {
		var project = req.body.project;
		project = path.join(workspaceRoot, req.user.workspace, project);
		if (!sharedUtil.projectExists(project)) {
			throw new Error("Project does not exist");
		}

		//if remove project was successful, return 200
		removeProject(project)
		.then(function(result) {
			res.end();
		});
	});
	
	app.put('/updateProject', function(req, res) {
		res.end();
	});
	
	return app;
};