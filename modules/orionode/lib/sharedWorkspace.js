/*******************************************************************************
 * Copyright (c) 2012 IBM Corporation and others.
 * All rights reserved. This program and the accompanying materials are made 
 * available under the terms of the Eclipse Public License v1.0 
 * (http://www.eclipse.org/legal/epl-v10.html), and the Eclipse Distribution 
 * License v1.0 (http://www.eclipse.org/org/documents/edl-v10.html). 
 *
 * Contributors:
 *     IBM Corporation - initial API and implementation
 *******************************************************************************/
/*eslint-env node*/
var fileUtil = require('./fileUtil');
var express = require('express');
var tree = require('./shared/tree');
var sharedUtil = require('./shared/sharedUtil');

module.exports = function(options) {
	var workspaceRoot = options.root;
	var fileRoot = options.fileRoot;
	if (!fileRoot) { throw new Error('options.root path required'); }
	if (!workspaceRoot) { throw new Error('options.root path required'); }
	
	var router = express.Router();

	router.use("/sharedUtil", sharedUtil.router(options));
	router.use("/tree", tree.router(options));
	return router;
}

// module.exports = function(options) {
// 	/**
// 	 * @returns {String} The URL of the workspace middleware, with context path.
// 	 */
// 	function originalWorkspaceRoot(req) {
// 		return workspaceRoot;
// 	}
// 	function originalFileRoot(req) {
// 		return fileRoot;
// 	}
// 	function makeProjectContentLocation(req, projectName) {
// 		return api.join(originalFileRoot(req), projectName);
// 	}
// 	function makeProjectLocation(req, projectName) {
// 		return api.join(fileRoot, projectName);
// 	}