

import is from '../is';
import compose from '../compose';
import { invariant } from '../utils';
import convertor from './convertor';


const MIMETYPES = {
  TEXT: '*/*',
  XML: 'text/xml',
  JSON: 'application/json',
  POST: 'application/x-www-form-urlencoded',
  DOCUMENT: 'text/html'
};

const ACCEPT = {
  TEXT: '*/*',
  XML: 'application/xml; q=1.0, text/xml; q=0.8, */*; q=0.1',
  JSON: 'application/json; q=1.0, text/*; q=0.8, */*; q=0.1'
};


function hasHeader( name_ ) {
  return function ( headers ) {
    return Object.keys( headers ).some( name => name.toLowerCase() === name_.toLowerCase());
  };
}

function hasAccept( headers ) {
  return hasHeader( 'accept' )( headers );
}

function hasContentType( headers ) {
  return hasHeader( 'content-type' )( headers );
}

function encode( value ) {
  return encodeURIComponent( value );
}

function getQueryString( object ) {
  return Object.keys( object ).reduce(( acc, item ) => {
    const prefix = !acc ? '' : `${acc}&`;
    return `${prefix + encode( item )}=${encode( object[item])}`;
  }, '' );
}

function objectToQueryString( data ) {
  return is.PlainObject( data ) ? getQueryString( data ) : data;
}

function setHeaders( xhr, { headers, dataType, method }) {

  const TYPE = dataType.toUpperCase();

  if ( !hasAccept( headers )) {
    headers.Accept = ACCEPT[TYPE] || ACCEPT.TEXT;
  }

  if ( !hasContentType( headers ) && method !== 'get' ) {
    headers['Content-Type'] = MIMETYPES[TYPE] || MIMETYPES.POST;
  }

  Object.keys( headers ).forEach( name => {
    if ( headers[name]) {
      xhr.setRequestHeader( name, headers[name]);
    }
  });
}

function getDataType( xhr ) {
  const ct = xhr.getResponseHeader( 'Content-Type' );
  if ( ct.indexOf( MIMETYPES.JSON ) > -1 ) {
    return 'json';
  } else if ( ct.indexOf( MIMETYPES.XML ) > -1 ) {
    return 'xml';
  }
  return 'text';
}

function convertors( dataType ) {
  return function ( xhr, convertor ) {
    if ( dataType ) {
      return convertor( dataType, xhr );
    }
    return convertor( getDataType( xhr ), xhr );
  };
}

function parseResponse( xhr, ctors ) {
  let result;
  try {
    if ( ctors ) {
      result = ctors( xhr, convertor );
    } else {
      result = xhr.response;
    }
  } catch ( e ) {
    result = xhr.response;
  }
  return [ result, xhr ];
}

function ready( xhr2, xdr, ctors, timeout, aborted, xhr ) {
  return function handleReady( appendMethods ) {
    if ( xhr.readyState === xhr.DONE ) {
      if ( timeout ) {
        clearTimeout( timeout );
      }
      if ( !aborted ) {
        if ( xhr2 || xdr ) {
          xhr.onload = null;
          xhr.onerror = null;
        } else if ( xhr.removeEventListener ) {
          xhr.removeEventListener( 'readystatechange', handleReady, false );
        } else {
          xhr.onreadystatechange = null;
        }
        if (( xhr.status >= 200 && xhr.status < 300 ) || xhr.status === 304 ) {
          if ( appendMethods.then ) {
            appendMethods.then( ...parseResponse( xhr, ctors ));
          }
        } else if ( appendMethods.catch ) {
          appendMethods.catch( ...parseResponse( xhr, ctors ));
        }
        if ( appendMethods.finally ) {
          appendMethods.finally( ...parseResponse( xhr, ctors ));
        }
      }
    }
  };
}


function handleTimeout( xhr, ontimeout ) {
  return function () {
    if ( !xhr.aborted ) {
      xhr.abort();
      if ( ontimeout ) {
        ontimeout( xhr );
      }
    }
  };
}


// test window
if ( is.Undefined( window )) {
  throw Error( 'Hope: Ajax only for browser environment.' );
}

const getXhr = window.XMLHttpRequest
  ? () => new window.XMLHttpRequest()
  : () => new window.ActiveXObject( 'Microsoft.XMLHTTP' );


function fixXhr( xhr_, options ) {

  let xhr;
  let xdr = false;
  const xhr2 = xhr_.responseType === '';

  if ( options.crossOrigin ) {
    if ( !xhr2 && window.XDomainRequest ) {
      xhr = new window.XDomainRequest(); // CORS with IE8/9
      xdr = true;
      if ( options.method !== 'get' && options.method !== 'post' ) {
        options.method = 'post';
      }
      return [ xhr, xdr, xhr2 ];
    }
    throw Error( 'Hope: CrossOrigin is not support.' );
  }
  return [ xhr_, xdr, xhr2 ];
}


function xhrConnection( method, url, data, options ) {

  let aborted;
  let nativeParsing;
  let queryString = '';
  const appendMethods = {};
  const returnMethods = [ 'then', 'catch', 'finally' ];
  const promiseMethods = returnMethods.reduce(( promise, method ) => {
    // eslint-disable-next-line
    promise[method] = function ( callback ) {
      const old = appendMethods[method];
      appendMethods[method] = old ? compose( callback, old ) : callback;
      return promise;
    };
    return promise;
  }, {});

  const [ xhr, xdr, xhr2 ] = fixXhr( getXhr(), options );

  if ( method === 'get' && data ) {
    queryString = `?${objectToQueryString( data )}`;
  }

  if ( xdr ) {
    xhr.open( method, url + queryString );
  } else {
    xhr.open( method, url + queryString, options.async, options.user, options.password );
  }

  // withCredentials cross domain
  if ( xhr2 ) {
    xhr.withCredentials = !!( options.async || options.withCredentials );
  }

  // headers
  if ( !xdr ) {
    setHeaders( xhr, options );
  }

  // timeout
  let timeout;
  if ( options.async ) {
    if ( xhr2 ) {
      xhr.timeout = options.timeout;
      xhr.ontimeout = options.ontimeout;
    } else if ( options.ontimeout ) {
      timeout = setTimeout( handleTimeout( xhr, options.ontimeout ), options.timeout );
    }
  } else if ( xdr ) {
    xhr.ontimeout = function () {};
  }

  if ( xhr2 ) {
    try {
      xhr.responseType = options.dataType;
      nativeParsing = ( xhr.responseType === options.dataType );
    } catch ( e ) {}
  } else {
    xhr.overrideMimeType( MIMETYPES[options.dataType.toUpperCase()]);
  }

  const ctors = nativeParsing || convertors( options.dataType );
  const handleResponse = () => ready(
    xhr2, xdr, ctors, timeout, aborted, xhr
  )( appendMethods );
  if ( xhr2 || xdr ) {
    xhr.onload = handleResponse;
    xhr.onerror = handleResponse;
    // http://cypressnorth.com/programming/internet-explorer-aborting-ajax-requests-fixed/
    if ( xdr ) {
      xhr.onprogress = function () {};
    }
  } else if ( xhr.addEventListener ) {
    xhr.addEventListener( 'readystatechange', handleResponse, false );
  } else {
    xhr.onreadystatechange = handleResponse;
  }

  xhr.send( method !== 'get' ? objectToQueryString( data ) : null );
  promiseMethods.abort = function () {
    if ( !aborted ) {
      if ( timeout ) {
        clearTimeout( timeout );
      }
      aborted = true;
      xhr.abort();
    }
  };
  return promiseMethods;
}


/**
 * option {
 *   method: string,
 *   headers: object
 *   timeout: number
 *   ontimeout: function
 *   baseUrl: string,
 *   data: object,
 *   url: string,
 *   withCredentials: boolean
 *   crossDomain: boolean,
 *   async: boolean,
 *   user: string,
 *   password: string,
 *   dataType: string,
 *   cache: string
 * }
 */


const defaultOption = {
  method: 'get',
  headers: { 'X-Requested-With': 'XMLHttpRequest' },
  timeout: 10 * 1000,
  ontimeout: null,
  baseUrl: '',
  data: null,
  url: '',
  withCredentials: false,
  crossDomain: false,
  async: true,
  user: '',
  password: '',
  dataType: 'json',
  cache: false
};

function getOption({
  method,
  headers,
  timeout,
  ontimeout,
  baseUrl,
  data,
  url,
  withCredentials,
  crossDomain,
  async,
  user,
  password,
  dataType,
  cache
}) {

  const options = Object.assign({}, defaultOption );

  if ( is.String( method ) && method ) {
    options.method = method;
  }

  if ( is.PlainObject( headers )) {
    Object.assign( options.headers, headers );
  }

  if ( is.Number( timeout ) && isFinite( timeout )) {
    options.timeout = Math.max( 0, timeout );
  }

  if ( is.Function( ontimeout )) {
    options.ontimeout = ontimeout;
  }

  if ( is.String( baseUrl ) && baseUrl ) {
    options.baseUrl = baseUrl;
  }

  if ( is.PlainObject( data )) {
    options.data = Object.assign({}, data );
  }

  if ( is.String( url ) && url ) {
    options.url = url;
  }

  if ( withCredentials ) {
    options.withCredentials = !!withCredentials;
  }

  if ( crossDomain ) {
    options.crossDomain = !!crossDomain;
    if ( !options.crossDomain && options.headers['X-Requested-With'] === 'XMLHttpRequest' ) {
      delete options.headers['X-Requested-With'];
    }
  }

  if ( is.String( user ) && user ) {
    options.user = user;
    if ( is.String( password )) {
      options.password = password;
    }
  }

  if ( Object.keys( MIMETYPES ).includes( dataType )) {
    options.dataType = dataType;
  }

  // if ( 'ArrayBuffer' in window && data instanceof ArrayBuffer ) {
  //   options.dataType = 'arraybuffer';
  // } else if ( 'Blob' in window && data instanceof Blob ) {
  //   options.dataType = 'blob';
  // } else if ( 'Document' in window && data instanceof Document ) {
  //   options.dataType = 'document';
  // } else if ( 'FormData' in window && data instanceof FormData ) {
  //   options.dataType = 'formdata';
  // }

  const cacheControl = headers['Cache-Control'];
  if ( !cache && !is.String( cacheControl ) && cacheControl ) {
    options.headers['Cache-Control'] = 'no-cache';
  }

  options.async = !!async;

  invariant(
    options.url || options.baseUrl,
    'Hope: Url or BaseUrl must be a non-empty string.'
  );

  return options;
}


function ajax( options ) {
  return xhrConnection(
    options.method,
    options.baseUrl + options.url,
    options.data,
    options
  );
}

export default compose( ajax, getOption );
