(function($, $$) {

Mavo.attributes.push("mv-value", "mv-if");

var _ = Mavo.Expressions = $.Class({
	constructor: function(group) {
		if (group) {
			this.group = group;
			this.group.expressions = this;
		}

		this.all = []; // all Expression.Text objects in this group

		Mavo.hooks.run("expressions-init-start", this);

		if (this.group) {
			var template = this.group.template;

			if (template && template.expressions) {
				// We know which expressions we have, don't traverse again
				for (let et of template.expressions.all) {
					this.all.push(new Mavo.Expression.Text({
						template: et,
						group: this.group
					}));
				}
			}
			else {
				var syntax = Mavo.Expression.Syntax.create(this.group.element.closest("[mv-expressions]")) || Mavo.Expression.Syntax.default;
				this.traverse(this.group.element, undefined, syntax);
			}
		}

		this.dependents = new Set();

		this.active = true;

		// Watch changes and update value
		this.group.element.addEventListener("mavo:datachange", evt => this.update(evt));
	},

	/**
	 * Update all expressions in this group
	 */
	update: function callee(evt) {
		if (!this.active || this.group.isDeleted() || this.all.length + this.dependents.size === 0) {
			return;
		}

		var env = { context: this, data: this.group.getRelativeData() };

		Mavo.hooks.run("expressions-update-start", env);

		for (let ref of this.all) {
			ref.update(env.data, evt);
		}

		for (let exp of this.dependents) {
			exp.update();
		}
	},

	extract: function(node, attribute, path, syntax) {
		if (attribute && attribute.name == "mv-expressions") {
			return;
		}

		if ((attribute && _.directives.indexOf(attribute.name) > -1) ||
		    syntax.test(attribute? attribute.value : node.textContent)
		) {
			this.all.push(new Mavo.Expression.Text({
				node, syntax,
				path: path? path.slice(1).split("/").map(i => +i) : [],
				attribute: attribute && attribute.name,
				group: this.group
			}));
		}
	},

	// Traverse an element, including attribute nodes, text nodes and all descendants
	traverse: function(node, path = "", syntax) {
		if (node.nodeType === 8) {
			// We don't want expressions to be picked up from comments!
			// Commenting stuff out is a common debugging technique
			return;
		}

		if (node.nodeType === 3) { // Text node
			// Leaf node, extract references from content
			this.extract(node, null, path, syntax);
		}
		// Traverse children and attributes as long as this is NOT the root of a child group
		// (otherwise, it will be taken care of its own Expressions object)
		else if (node == this.group.element || !Mavo.is("group", node)) {
			syntax = Mavo.Expression.Syntax.create(node) || syntax;

			if (syntax === Mavo.Expression.Syntax.ESCAPE) {
				return;
			}

			$$(node.attributes).forEach(attribute => this.extract(node, attribute, path, syntax));
			$$(node.childNodes).forEach((child, i) => this.traverse(child, `${path}/${i}`, syntax));
		}
	},

	static: {
		directives: []
	}
});

if (self.Proxy) {
	Mavo.hooks.add("node-getdata-end", function(env) {
		if (env.options.relative && env.data && typeof env.data === "object") {
			env.data = new Proxy(env.data, {
				get: (data, property, proxy) => {
					// Checking if property is in proxy might add it to the data
					if (property in data || (property in proxy && property in data)) {
						return data[property];
					}

					if (property == "$index") {
						return this.index + 1;
					}

					if (property == this.mavo.id) {
						return data;
					}
				},

				has: (data, property) => {
					if (property in data) {
						return true;
					}

					// Property does not exist, look for it elsewhere

					if (property == "$index" || property == this.mavo.id) {
						return true;
					}

					// First look in ancestors
					var ret = this.walkUp(group => {
						if (property in group.children) {
							return group.children[property];
						};
					});

					if (ret === undefined) {
						// Still not found, look in descendants
						ret = this.find(property);
					}

					if (ret !== undefined) {
						if (Array.isArray(ret)) {
							ret = ret.map(item => item.getRelativeData(env.options))
									 .filter(item => item !== null);
						}
						else if (ret instanceof Mavo.Node) {
							ret = ret.getRelativeData(env.options);
						}

						data[property] = ret;

						return true;
					}

					return false;
				},

				set: function(data, property, value) {
					throw Error("You can’t set data via expressions.");
				}
			});
		}
	});
}

Mavo.Node.prototype.getRelativeData = function() {
	return this.getData({
		relative: true,
		store: "*",
		null: true,
		unhandled: this.mavo.unhandled
	});
};

Mavo.hooks.add("group-init-start", function() {
	new Mavo.Expressions(this);
});

Mavo.hooks.add("group-init-end", function() {
	this.expressions.update();
});


// Disable expressions during rendering, for performance
Mavo.hooks.add("group-render-start", function() {
	this.expressions.active = false;
});

Mavo.hooks.add("group-render-end", function() {
	requestAnimationFrame(() => {
		this.expressions.active = true;
		this.expressions.update();
	});
});

})(Bliss, Bliss.$);

// mv-value plugin
Mavo.Expressions.directives.push("mv-value");

Mavo.hooks.add("expressiontext-init-start", function() {
	if (this.attribute == "mv-value") {
		this.attribute = Mavo.Primitive.getValueAttribute(this.element);
		this.fallback = this.fallback || Mavo.Primitive.getValue(this.element, {attribute: this.attribute});
		this.expression = this.element.getAttribute("mv-value");

		this.parsed = [new Mavo.Expression(this.expression)];
		this.expression = this.syntax.start + this.expression + this.syntax.end;
	}
});