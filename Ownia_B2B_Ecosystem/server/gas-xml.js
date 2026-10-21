// Shim de XmlService (solo lectura: parse + navegación). Lo usan las landings para leer el
// xlsx de tipos de cambio (un xlsx es un zip de XMLs). Cubre lo que usa ese código y la API
// de lectura de GAS: getRootElement, getNamespace, getChild/getChildren (por nombre local +
// namespace, como JDOM), getText/getValue, getAttribute.
//
// No resuelve DTDs ni entidades externas (nunca: evita XXE); solo las 5 entidades XML y las
// referencias numéricas.
const { ServicioNoMigrado } = require('./gas-services');

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function decode(s) {
  if (s.indexOf('&') === -1) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e] !== undefined ? ENTITIES[e] : m;
  });
}

function xmlError(msg) {
  const e = new Error(`XmlService: ${msg}`);
  e.name = 'Exception';
  return e;
}

function namespace(prefix, uri) {
  return { getPrefix: () => prefix || '', getURI: () => uri || '', _uri: uri || '' };
}

const NO_NS = namespace('', '');

// ---------- parser ----------

function parseXml(src) {
  const text = String(src);
  const root = { children: [], nsMap: { xml: 'http://www.w3.org/XML/1998/namespace' } };
  const stack = [root];
  const tagRe = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>[]*(\[[\s\S]*?\])?\s*>|<(\/?)([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  const attrRe = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let last = 0;
  let m;
  const top = () => stack[stack.length - 1];
  const pushText = (t) => {
    if (stack.length > 1 && t) top().children.push({ text: t });
    else if (t.trim()) throw xmlError('texto fuera del elemento raíz');
  };

  while ((m = tagRe.exec(text))) {
    pushText(decode(text.slice(last, m.index)));
    last = tagRe.lastIndex;
    const tok = m[0];
    if (tok.startsWith('<!--') || tok.startsWith('<?')) continue;
    if (tok.startsWith('<!DOCTYPE')) {
      if (m[2]) throw xmlError('DTD interno no soportado');
      continue;
    }
    if (tok.startsWith('<![CDATA[')) { pushText(m[1]); continue; }

    const closing = m[3] === '/';
    const qname = m[4];
    if (closing) {
      const el = stack.pop();
      if (!el || el === root || el.qname !== qname) throw xmlError(`cierre inesperado </${qname}>`);
      continue;
    }
    const parent = top();
    const nsMap = Object.create(parent.nsMap);
    const rawAttrs = [];
    let a;
    attrRe.lastIndex = 0;
    while ((a = attrRe.exec(m[5] || ''))) {
      const name = a[1];
      const value = decode(a[2] !== undefined ? a[2] : a[3]);
      if (name === 'xmlns') nsMap[''] = value;
      else if (name.startsWith('xmlns:')) nsMap[name.slice(6)] = value;
      else rawAttrs.push([name, value]);
    }
    const [prefix, local] = qname.includes(':') ? qname.split(':', 2) : ['', qname];
    const uri = nsMap[prefix];
    if (prefix && uri === undefined) throw xmlError(`prefijo de namespace sin declarar: ${prefix}`);
    const el = {
      qname, local, prefix, uri: uri || '', nsMap, children: [],
      attrs: rawAttrs.map(([n, v]) => {
        // Los atributos sin prefijo no tienen namespace (regla XML, igual que JDOM).
        const [ap, al] = n.includes(':') ? n.split(':', 2) : ['', n];
        return { local: al, prefix: ap, uri: ap ? nsMap[ap] || '' : '', value: v };
      }),
    };
    parent.children.push(el);
    if (m[6] !== '/') stack.push(el);
  }
  pushText(decode(text.slice(last)));
  if (stack.length !== 1) throw xmlError(`falta cerrar <${top().qname}>`);
  const elements = root.children.filter((c) => c.text === undefined);
  if (elements.length !== 1) throw xmlError('el documento tiene que tener un único elemento raíz');
  return elements[0];
}

// ---------- API estilo GAS ----------

function nsUri(ns) {
  if (ns == null) return '';
  return typeof ns.getURI === 'function' ? ns.getURI() : String(ns);
}

function textOf(node) {
  return node.children.filter((c) => c.text !== undefined).map((c) => c.text).join('');
}

function valueOf(node) {
  return node.children.map((c) => (c.text !== undefined ? c.text : valueOf(c))).join('');
}

function attributeObj(a) {
  return {
    getName: () => a.local,
    getValue: () => a.value,
    getNamespace: () => namespace(a.prefix, a.uri),
    toString: () => `[Attribute: ${a.local}="${a.value}"]`,
  };
}

function elementObj(node) {
  const children = () => node.children.filter((c) => c.text === undefined);
  const match = (name, ns) => (c) => (name == null || c.local === name) && c.uri === nsUri(ns);
  return {
    getName: () => node.local,
    getQualifiedName: () => node.qname,
    getNamespace: (prefix) => {
      if (prefix === undefined) return node.uri ? namespace(node.prefix, node.uri) : NO_NS;
      const uri = node.nsMap[prefix];
      return uri === undefined ? null : namespace(prefix, uri);
    },
    // Como JDOM/GAS: sin namespace solo matchea elementos sin namespace.
    getChild: (name, ns) => {
      const c = children().find(match(name, ns));
      return c ? elementObj(c) : null;
    },
    getChildren: (name, ns) => {
      const list = name === undefined ? children() : children().filter(match(name, ns));
      return list.map(elementObj);
    },
    getChildText: (name, ns) => {
      const c = children().find(match(name, ns));
      return c ? textOf(c) : null;
    },
    getText: () => textOf(node),
    getValue: () => valueOf(node),
    getAttribute: (name, ns) => {
      const a = node.attrs.find((x) => x.local === name && x.uri === nsUri(ns));
      return a ? attributeObj(a) : null;
    },
    getAttributes: () => node.attrs.map(attributeObj),
    getContentSize: () => node.children.length,
    isRootElement: () => false,
    toString: () => `[Element: <${node.qname}/>]`,
  };
}

function makeXmlService() {
  const notMigrated = (m) => () => { throw new ServicioNoMigrado('XmlService', m); };
  return {
    parse: (xml) => {
      const root = parseXml(xml);
      return {
        getRootElement: () => ({ ...elementObj(root), isRootElement: () => true }),
        hasRootElement: () => true,
      };
    },
    getNamespace: (a, b) => (b === undefined ? namespace('', a) : namespace(a, b)),
    getNoNamespace: () => NO_NS,
    getXmlNamespace: () => namespace('xml', 'http://www.w3.org/XML/1998/namespace'),
    createDocument: notMigrated('createDocument'),
    createElement: notMigrated('createElement'),
    getPrettyFormat: notMigrated('getPrettyFormat'),
    getRawFormat: notMigrated('getRawFormat'),
    getCompactFormat: notMigrated('getCompactFormat'),
  };
}

module.exports = { makeXmlService, parseXml };
