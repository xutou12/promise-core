

import pick from 'object.pick';
import ajaxXhr from './ajax-xhr';
import compose from '../compose';
import is, { property } from '../is';
import { invariant, log } from '../utils';
import Chain from '../chain';


const ajaxSymbol = Symbol( 'ajax' );
const ajaxHandler = Symbol( 'ajaxHandler' );
const isAjax = property( ajaxSymbol );
const globalMap = {

  // converters: {
  //   xml:
  //   html:
  //   script:
  //   json: JSON.parse,
  //   jsonp:
  // },

  urls: {},
  tokens: new Map(),

  setURLTokens( pairs ) {
    const tokens = globalMap.tokens;
    Object.entries( pairs ).forEach(([ token, value ]) => {
      tokens.set( token, [ new RegExp( `{${token}}`, 'g' ), value ]);
    });
  },

  setURLAlias( aliases, transform ) {
    const urls = globalMap.urls;
    Object.entries( aliases ).forEach(([ alias, url ]) => {
      urls[alias] = url;
    });
    if ( is.Function( transform )) {
      globalMap.URLTransform = transform;
    }
  },

  setDataTransform( transform ) {
    if ( is.Function( transform )) {
      globalMap.dataTransform = transform;
    }
  },

  setAssert( assert ) {
    if ( is.Function( assert )) {
      globalMap.assert = assert;
    }
  },

  URLTransform( alias, tokens ) {
    let url = globalMap.urls[alias];
    if ( url ) {
      tokens.forEach(([ regexp, value ]) => {
        if ( regexp.test( url )) {
          url = url.replace( regexp, value );
        }
      });
      return url;
    }
    return alias;
  },

  dataTransform( type_, response, error, xhr_ ) {
    return response || error;
  },

  assert( type_, response, resolve_, reject_ ) {
    resolve_( response );
  }

};


// eslint-disable-next-line
const allocator = ( resolve, reject, options ) => ( success ) => ( cdResponse, xhr ) => {
  const { dataType } = options;
  const transform = globalMap.dataTransform;
  if ( success ) {
    if ( is.Function( options.assert )) {
      options.assert( dataType, transform( dataType, cdResponse, null, xhr ), resolve, reject );
    } else {
      globalMap.assert( dataType, transform( dataType, cdResponse, null, xhr ), resolve, reject );
    }
  // abort/timeout only print one warn
  // opened and no status code has been received from the server,status === 0
  } else if ( xhr.status === 0 ) {
    const txt = xhr.aborted ? 'abort' : 'timeout';
    log( 'warn', `Url (${options.url}) is ${txt}.` );
    reject( transform( dataType, null, txt, xhr ));
  } else {
    reject( transform( dataType, null, cdResponse, xhr ));
  }
};


function URLFormat( alias ) {
  return globalMap.URLTransform( alias, globalMap.tokens );
}


function getMethod({ data, method }) {
  if ( method ) {
    return method;
  }
  if ( data ) {
    return 'post';
  }
  return 'get';
}

function assignOption( obj, ...objs ) {
  const newObj = Object.assign( obj, ...objs );
  delete newObj[ajaxHandler];
  return newObj;
}

function getOptions( url, options_ ) {

  const options = {};

  // url is String, options is undefined/plain-object, two arguments
  if ( is.String( url )) {
    options.url = url;
    if ( is.PlainObject( options_ )) {
      assignOption( options, options_ );
    }
    options.method = getMethod( options );

  // url is PlainObject, only one argument
  } else if ( is.PlainObject( url )) {
    assignOption( options, url );
    options.method = getMethod( options );

  // url is Function, only one argument
  } else if ( is.Function( url )) {
    options[ajaxHandler] = url;
  }

  // dataType default 'json'
  if ( !is.String( options.dataType ) || options.dataType === '' ) {
    options.dataType = 'json';
  }

  if ( is.String( options.url )) {
    options.url = URLFormat( options.url );
  }

  // null/undefined => String('')
  if ( is.PlainObject( options.data )) {
    options.data = Object.entries( options.data ).reduce(( memo, [ key, value ]) => {
      memo[key] = is.Defined( value ) ? value : '';
      return memo;
    }, {});
  }

  return options;
}

function composeWithResult( callback, lastHandle ) {
  return ( ...results ) => {
    const result = lastHandle( ...results );
    if ( is.Defined( result )) {
      return callback( result );
    }
    return callback( ...results );
  };
}


/**
 * options {
 *   assert,
 *   dataType: 'json',
 *   headers: object
 *   timeout: number
 *   ontimeout: function
 *   baseUrl: string,
 *   data: object,
 *   url: string,
 *   withCredentials: boolean
 * }
 */
function Ajax( url, options ) {

  let next;
  let getNextXhrs;
  let sending = null;
  let handlerThen = null;
  let handlerCatch = null;
  let handlerBefore = null;
  let handlerFinally = null;

  const xhrs = [];
  const builders = [];
  const chainMethod = {

    [ajaxSymbol]: true,

    then( callback ) {
      handlerThen = handlerThen ? composeWithResult( callback, handlerThen ) : callback;
    },

    catch( callback ) {
      handlerCatch = handlerCatch ? composeWithResult( callback, handlerCatch ) : callback;
    },

    always( callback ) {
      chainMethod.then(( ...results ) => callback( null, results ));
      chainMethod.catch( err => callback( err, null ));
    },

    before( callback ) {
      handlerBefore = handlerBefore ? composeWithResult( callback, handlerBefore ) : callback;
    },

    finally( callback ) {
      handlerFinally = handlerFinally ? composeWithResult( callback, handlerFinally ) : callback;
    },

    getXhr() {
      if ( getNextXhrs ) {
        return getNextXhrs();
      }
      return xhrs;
    },

    abort() {
      const xhrs = chainMethod.getXhr();
      while ( xhrs.length ) {
        xhrs.pop().abort();
      }
    }

  };


  // create new chain of ajax
  function newAjax( options ) {
    let abort;
    const chain = Chain.of(( resolve, reject ) => {
      const callback = allocator( resolve, reject, options );
      abort = ajaxXhr( options )
        .then( callback( true ))
        .catch( callback( false )).abort;
    });
    chain.abort = abort;
    return chain;
  }


  function nextAjax( options, ajaxHandler ) {
    if ( sending ) {
      if ( next ) {
        const prev = next;
        next = function( ...result ) {
          return prev( ...result ).ajax( options || ajaxHandler );
        };
      } else {
        const finallys = handlerFinally;
        next = ajaxHandler
          ? function( ...result ) {
            return ajaxHandler( ...result ).finally(( ...rs ) => finallys( ...result, ...rs ));
          } : function( ...result ) {
            return Ajax( options ).finally(( ...rs ) => finallys( ...result, ...rs ));
          };
        handlerFinally = null;
      }
    } else {
      builders.push( options || ajaxHandler );
    }
  }


  function createAjax( options, method ) {
    if ( options.url ) {
      nextAjax( Object.assign( options, { method }));
      return true;
    } else if ( options[ajaxHandler]) {
      nextAjax( null, options[ajaxHandler]);
      return true;
    }
    return false;
  }


  function append( funcName, ...args ) {
    const prev = next;
    const needLastResults = [ 'ajax', 'get', 'post', 'put', 'delete', 'then',
      'always', 'finally' ].includes( funcName );
    const nextArgs = args.length === 1 && is.Function( args[0]) && needLastResults
      ? ( result ) => [args[0].bind( undefined, ...result )]
      : () => args;
    next = function( ...result ) {
      return prev( ...result )[funcName]( ...nextArgs( result ));
    };
  }


  function remove( xhr ) {
    xhrs.splice( xhrs.indexOf( xhr ), 1 );
  }


  function setXhrs() {
    return builders.reduce(( xhrs, options ) => {
      let ajaxObject;
      if ( is.Function( options )) {
        const ajax = options();
        invariant(
          isAjax( ajax ),
          'Hope: Function of ajax() expecting a ajax-object be returned.'
        );
        ajaxObject = ajax.getXhr()[0].always(() => remove( ajaxObject ));
      } else {
        ajaxObject = newAjax( options ).always(() => remove( ajaxObject ));
      }
      xhrs.push( ajaxObject );
      return xhrs;
    }, xhrs );
  }


  function getNext( ajaxObject ) {
    invariant(
      isAjax( ajaxObject ),
      'Hope: Function of ajax() expecting a ajax-object be returned.'
    );
    getNextXhrs = ajaxObject.getXhr;
  }


  function connection() {

    if ( sending ) return;

    const xhrs = setXhrs();
    if ( handlerBefore ) {
      handlerBefore( ...xhrs );
    }

    sending = Chain.all( xhrs ).then(( ...results ) => {
      let result;
      if ( handlerThen ) {
        result = handlerThen( ...results );
      }
      if ( next ) {
        if ( is.Defined( result )) {
          getNext( next( result ));
        } else {
          getNext( next( ...results ));
        }
      }
    }).catch(( err ) => {
      if ( handlerCatch ) {
        handlerCatch( err.length === 1 ? err[0] : err );
      }
    }).then(( ...results ) => {
      if ( handlerFinally ) {
        handlerFinally( ...results );
      }
    });
  }


  // ajax methods
  [ 'ajax', 'get', 'post', 'put', 'delete' ].forEach( method => {
    chainMethod[method] = compose( options => {
      if ( createAjax( options, method === 'ajax' ? options.method : method )) {
        return chainMethod;
      }
      return pick( chainMethod, [ 'ajax', 'get', 'post', 'put', 'delete' ]);
    }, getOptions ); /* ( url, options ) */
  });


  // add xhr connection
  [ 'then', 'catch', 'before', 'always', 'finally' ].forEach( func => {
    const funcBody = chainMethod[func];
    chainMethod[func] = function( callback ) {
      if ( callback ) {
        funcBody( callback );
      }
      connection();
      return chainMethod;
    };
  });

  // if next ajax is exist, all function will append to the next ajax
  [ 'ajax', 'get', 'post', 'put', 'delete', 'before', 'then', 'catch',
    'always', 'finally' ].forEach( func => {
      const body = chainMethod[func];
      chainMethod[func] = function( ...args ) {
        if ( next ) {
          append( func, ...args );
          return chainMethod;
        }
        return body( ...args );
      };
    });


  // success === done === then && error === fail === catch
  chainMethod.success =
  chainMethod.done = chainMethod.then;
  chainMethod.error =
  chainMethod.fail = chainMethod.catch;

  // init
  return chainMethod.ajax( url, options );
}


Object.assign( Ajax, pick( globalMap, [
  'setURLTokens',
  'setURLAlias',
  'setDataTransform',
  'setAssert'
]), {
  getURL: URLFormat
});

export default Ajax;

