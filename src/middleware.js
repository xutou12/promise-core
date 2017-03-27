

import is, { property, kindOf } from './is';
import { HOPE_ACTION, invariant } from './utils';


export default function hopeMiddlewareFactory( _options = {}) {
  const getHandler = property( 'handler' );
  const isHopeAction = property( HOPE_ACTION );
  return store => next => action => {
    const { payload, type } = action;
    if ( isHopeAction( action )) {
      const handler = getHandler( payload );
      invariant(
        is.Function( handler ),
        `Hope: Expecting handler of ${type} is a function in instanceof check, but got ${kindOf( handler )}`
      );
      handler( store, action );
    }
    return next( action );
  };
}
