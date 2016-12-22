/*******************************************************************************
 * @license
 * Copyright (c) 2016 IBM Corporation and others.
 * All rights reserved. This program and the accompanying materials are made 
 * available under the terms of the Eclipse Public License v1.0 
 * (http://www.eclipse.org/legal/epl-v10.html), and the Eclipse Distribution 
 * License v1.0 (http://www.eclipse.org/org/documents/edl-v10.html). 
 * 
 * Contributors: IBM Corporation - initial API and implementation
 ******************************************************************************/

/*eslint-env browser, amd*/
/*global URL*/
define(["orion/xhr", "orion/Deferred", "orion/URL-shim",  "orion/form"], function(xhr, Deferred, _, form) {
	return {
		shareProjectUrl: "/sharedWorkspace/project/shareProject",
		unshareProjectUrl: "/sharedWorskpace/project/unshareProject",
		addUserUrl: "/sharedWorkspace/user/addProjectUser",
		removeUserUrl: "/sharedWorkspace/user/removeProjectUser",
		shareProject: function(project) {
			return xhr("POST", this.shareProjectUrl, {
				headers: {
					"Orion-Version": "1",
					"X-Create-Options" : "no-overwrite",
					"Content-Type": "application/json;charset=UTF-8"
				},
				data: JSON.stringify({
					"project": project
				})
			});
		},
		unshareProject: function(project) {
			return xhr("DELETE", this.unshareProjectUrl, {
				headers: {
					"Orion-Version": "1",
					"X-Create-Options" : "no-overwrite",
					"Content-Type": "application/json;charset=UTF-8"
				},
				data: JSON.stringify({
					"project": project
				})
			});
		},
		addUser: function(username, project) {
			return xhr("POST", this.addUserUrl, {
				headers: {
					"Orion-Version": "1",
					"X-Create-Options" : "no-overwrite",
					"Content-Type": "application/json;charset=UTF-8"
				},
				data: JSON.stringify({
					"project": project,
					"username": username
				})
			});
		},
		removeUser: function(username, project) {
			return xhr("DELETE", this.removeUserUrl, {
				headers: {
					"Orion-Version": "1",
					"X-Create-Options" : "no-overwrite",
					"Content-Type": "application/json;charset=UTF-8"
				},
				data: JSON.stringify({
					"project": project,
					"username": username
				})
			});
		}
	}
});