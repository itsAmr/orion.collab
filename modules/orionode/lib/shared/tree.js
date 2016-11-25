/*******************************************************************************
 * Copyright (c) 2012 IBM Corporation and others.
 * All rights reserved. This program and the accompanying materials are made 
 * available under the terms of the Eclipse Public License v1.0 
 * (http://www.eclipse.org/legal/epl-v10.html), and the Eclipse Distribution 
 * License v1.0 (http://www.eclipse.org/org/documents/edl-v10.html). 
 *
 * Contributors:
 *		 IBM Corporation - initial API and implementation
 *******************************************************************************/
/*eslint-env node */
var api = require('../api'), writeError = api.writeError;
var git = require('nodegit');
var path = require('path');
var express = require('express');
var mime = require('mime');
var sharedUtil = require('./sharedUtil');
var fileUtil = require('../fileUtil');
var fs = require('fs');
var sharedProjects = require('./db/sharedProjects');

module.exports = {};

module.exports.router = function(options) {
	var workspaceRoot = options.options.workspaceDir;
	if (!workspaceRoot) { throw new Error('options.options.workspaceDir required'); }

	return express.Router()
	.get('/', getSharedWorkspace)
	.get('/file*', getTree)
	.put('/file*', putFile);

	/**
	 * Get shared projects for the user.
	 */
	function getSharedWorkspace(req, res) {
		//if its the base call, return all Projects that are shared with the user
		return sharedUtil.getSharedProjects(req, res, function(projects) {
			var tree = sharedUtil.treeJSON("/", "", 0, true, 0, false);
			var children = tree.Children = [];
			function add(projects) {
				projects.forEach(function(project) {
					children.push(sharedUtil.treeJSON(project.Name, project.Location, 0, true, 0, false));
					if (project.Children) add(project.Children);
				});
			}
			add(projects, tree);
			tree["Projects"] = children.map(function(c) {
				return {
					Id: c.Name,
					Location:  c.Location,
				};
			});
			res.status(200).json(tree);
		});
	}

	/**
	 * return files and folders below current folder or retrieve file contents.
	 */
	function getTree(req, res) {
		var tree;
		var filePath = path.join(workspaceRoot, req.params["0"]);
		var fileRoot = req.params["0"];
		fileUtil.withStatsAndETag(filePath, function(err, stats, etag) {
			if (err) throw err;
			if (stats.isDirectory()) {
				sharedUtil.getChildren(fileRoot, filePath, req.query.depth ? req.query.depth: 1)
				.then(function(children) {
					// TODO this is basically a File object with 1 more field. Should unify the JSON between workspace.js and file.js
					children.forEach(function(child) {
						child.Id = child.Name;
					});
					location = fileRoot;
					var name = path.basename(filePath);
					tree = {
						Name: name,
						Location: "/sharedWorkspace/tree/file" + location,
						ChildrenLocation: "/sharedWorkspace/tree/file" + location + "?depth=1",
						Children: children,
						Directory: true
					};
				})
				.then(function() {
					return sharedProjects.getHubID(filePath);
				})
				.then(function(hub){
					if (hub) {
						tree.Attributes = {};
						tree["Attributes"].hubID = hub;
					}
					res.status(200).json(tree);
				})
				.catch(api.writeError.bind(null, 500, res));
			} else if (stats.isFile()) {
					if (req.query.parts === "meta") {
						var name = path.basename(filePath);
						var result = sharedUtil.treeJSON(name, fileRoot, 0, false, 0, false);
						result.ETag = etag;
						// createParents(result);
						sharedProjects.getHubID(filePath)
						.then(function(hub){
							if (hub) {
								result["Attributes"].hubID = hub;
							}
							return res.status(200).json(result);
						});
					} else {
						sharedUtil.getFile(res, filePath, stats, etag);
					}
			}
		});
	}

	/**
	 * For file save.
	 */
	function putFile(req, res) {
		var filepath = path.join(workspaceRoot, req.params["0"]);
		var fileRoot = req._parsedUrl.pathname;
		if (req.params['parts'] === 'meta') {
			// TODO implement put of file attributes
			res.sendStatus(501);
			return;
		}
		function write() {
			var ws = fs.createWriteStream(filepath);
			ws.on('finish', function() {
				fileUtil.withStatsAndETag(filepath, function(error, stats, etag) {
					if (error && error.code === 'ENOENT') {
						res.status(404).end();
						return;
					}
					writeFileMetadata(fileRoot, req, res, filepath, stats, etag);
				});
			});
			ws.on('error', function(err) {
				writeError(500, res, err);
			});
			req.pipe(ws);
		}
		var ifMatchHeader = req.headers['if-match'];
		if (!ifMatchHeader) {
			return write();
		}
		fileUtil.withETag(filepath, function(error, etag) {
			if (error && error.code === 'ENOENT') {
				res.status(404).end();
			}
			else if (ifMatchHeader && ifMatchHeader !== etag) {
				res.status(412).end();
			}
			else {
				write();
			}
		});
	}

	function writeFileMetadata(fileRoot, req, res, filepath, stats, etag) {
		var result;
		return fileJSON(fileRoot, workspaceRoot, filepath, stats)
		.then(function(originalJson){
			result = originalJson;
			if (etag) {
				result.ETag = etag;
				res.setHeader('ETag', etag);
			}
			res.setHeader("Cache-Control", "no-cache");
			api.write(null, res, null, result);
		})
		.catch(api.writeError.bind(null, 500, res));
	};

	function fileJSON(fileRoot, workspaceDir, filepath, stats) {
		var isDir = stats.isDirectory();
		if (!isDir) {
			var wwwpath = api.toURLPath(filepath.substring(workspaceDir.length + 1));
			var name = path.basename(filepath);
			var timeStamp = stats.mtime.getTime(),
			result = sharedUtil.treeJSON(name, fileRoot, timeStamp, isDir, 0, false);
			result.ChildrenLocation = {pathname: result.Location, query: {depth:1}};
			return Promise.resolve(result);
		}
	}
};
