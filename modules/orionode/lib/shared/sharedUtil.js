/*******************************************************************************
 * Copyright (c) 2012 IBM Corporation and others.
 * All rights reserved. This program and the accompanying materials are made 
 * available under the terms of the Eclipse Public License v1.0 
 * (http://www.eclipse.org/legal/epl-v10.html), and the Eclipse Distribution 
 * License v1.0 (http://www.eclipse.org/org/documents/edl-v10.html). 
 *
 * Contributors:
 *	 IBM Corporation - initial API and implementation
 *******************************************************************************/
/*eslint-env node */
/*eslint no-console:1*/
var api = require('../api'), writeError = api.writeError;
var url = require("url");
var path = require("path");
var fs = require('fs');
var async = require('async');
var fileUtil = require('../fileUtil');
var tasks = require('../tasks');
var express = require('express');
var bodyParser = require('body-parser');
var rmdir = require('rimraf');
var Promise = require('bluebird');

module.exports = {};

module.exports.router = function(options) {
	var fileRoot = options.fileRoot;
	if (!fileRoot) { throw new Error('options.root is required'); }

	module.exports.getFile = getFile;
    module.exports.treeJSON = treeJSON;
    module.exports.getChildren = getChildren;
	module.exports.getSharedWorkspaces = getSharedWorkspaces;
	module.exports.isWorkspace = isWorkspace;

	return express.Router()
	.use(bodyParser.json());

function isWorkspace(req){
	return !fs.existsSync(path.join(req.user.workspaceDir,'.git'));
}

/**
 * returns stat which contains isDirectory method
 */
function getFile(res, filepath, stats, etag) {
	var stream = fs.createReadStream(filepath);
	res.setHeader("Cache-Control", "no-cache");
	res.setHeader('Content-Length', stats.size);
	res.setHeader('ETag', etag);
	res.setHeader('Accept-Patch', 'application/json-patch; charset=UTF-8');
	stream.pipe(res);
	stream.on('error', function(e) {
		// FIXME this is wrong, headers have likely been committed at this point
		res.writeHead(500, e.toString());
		res.end();
	});
	stream.on('end', res.end.bind(res));
}

function sharedJSON(name, location, children, parents, submodules) {
	var result = {
		"ContentLocation": location,
		"Location": "/sharedWorkspace/tree" + location,
        "ChildrenLocation": "/sharedWorkspace/tree" + location + "?depth=1",
		"Name": name,
		"Children": submodules && submodules.length ? submodules : undefined,
		"Parents": parents && parents.length ? parents : undefined
	};

	return result;
}

/**
 * if opening a file, we don't want to add the name to the location so addNameToLoc needs to be false
 * else undefined
 */
function treeJSON(name, location, timestamp, dir, length, addNameToLoc) {
    location = api.toURLPath(location);
    if (typeof addNameToLoc == 'undefined' || addNameToLoc) {
		location += "/" + name;
	}
    return {
        Name: name,
        LocalTimeStamp: timestamp,
        Directory: dir,
        Length: length,
        Location: "/sharedWorkspace/tree" + location,
        ChildrenLocation: dir ? "/sharedWorkspace/tree" + location + "?depth=1": undefined,
        Attributes: {
            ReadOnly: false
        }
    };
}

function getChildren(fileRoot, workspaceDir, directory, depth, excludes) {
	return fs.readdirAsync(directory)
	.then(function(files) {
		return Promise.map(files, function(file) {
			if (Array.isArray(excludes) && excludes.indexOf(file) !== -1) {
				return null; // omit
			}
			var filepath = path.join(directory, file);
			return fs.statAsync(filepath)
			.then(function(stats) {
                var isDir = stats.isDirectory();
				return treeJSON(file, fileRoot, 0, isDir, depth ? depth - 1 : 0);
			})
			.catch(function() {
				return null; // suppress rejection
			});
		});
	})
	.then(function(results) {
		return results.filter(function(r) { return r; });
	});
};

/**
 * This function gets the workspaces shared to this user and returns their paths.
 */
function getSharedWorkspaces(req, res, callback) {
    var workspaces = [];
    // db.getList()
    // .then(function(sharedSpaces) {
        var sharedSpaces = [
            {
                Name: "potato",
                ContentLocation: '\\file\\mo\\mourad\\OrionContent',
            },
            {
                Name: "level1",
                ContentLocation: '\\file\\mo\\mourad\\OrionContent'
            },
            {
                Name: "web",
                ContentLocation: '\\file\\mo\\mourad\\OrionContent',
            },
            {
                Name: ".orion",
                ContentLocation: '\\file\\Bo\\Bogdan\\OrionContent'
            }
        ];
        function add(lst) {
            lst.forEach(function(workspace) {
                workspaces.push(sharedJSON(workspace.Name, workspace.ContentLocation, 0, true, 0));
                if (workspace.Children) add(workspace.Children);
            });
        }
        add(sharedSpaces);
        callback(workspaces);
    // });
    return;
}

function getSignature(repo){
	return git.Signature.default(repo) || git.Signature.now("unknown","unknown@unknown.com");
}
};
