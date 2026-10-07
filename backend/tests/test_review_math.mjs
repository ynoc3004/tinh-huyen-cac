import assert from "node:assert/strict";
import {moveReview,meanAccuracy} from "../static/review-math.js";
assert.equal(moveReview(0,0,"w").accuracy,100);
assert.equal(moveReview(0,100,"w").loss,0);
assert.equal(moveReview(0,100,"b").loss,100);
assert.equal(moveReview(200,-100,"w").label,"Sai lầm lớn");
assert.equal(meanAccuracy([],"w"),null);
assert.equal(meanAccuracy([{color:"w",accuracy:80},{color:"w",accuracy:100},{color:"b",accuracy:10}],"w"),90);
console.log("Review accuracy tests passed.");
