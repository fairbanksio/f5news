angular.module('myApp', ['angularMoment', 'ngclipboard']) // eslint-disable-line no-undef
  .controller('myCtrl', ['$scope', '$interval', '$http', ($scope, $interval, $http) => {
    const firstFetch = () => {
      $http.get('/getPosts').then((response) => {
        $scope.posts = response.data;
      });
    };

    $scope.message = firstFetch();

    const today = new Date().getUTCHours(); // eslint-disable-line vars-on-top
    if (today >= 11 && today <= 23) {
      $scope.timeOfQuery = '60';
    } else {
      $scope.timeOfQuery = '120';
    }

    $scope.setBackgroundColor = (value) => {
      if (value.upvoteCount >= 100 && value.upvoteCount < 250) {
        return 'trending';
      } else if (value.upvoteCount >= 250 && value.upvoteCount < 500) {
        return 'hot';
      } else if (value.upvoteCount >= 500) {
        return 'f5oclock';
      } else {
        return false;
      }
    };

    // Loop for fetching information from API routes
    $interval(() => {
      $http.get('/getPosts').then((response) => {
        $scope.posts = response.data;
      });
    }, 5000);
  }])
  .filter('cut', () => {
    return (value, wordwise, max, tail) => {
      if (!value) return '';

      max = parseInt(max, 10);
      if (!max) return value;
      if (value.length <= max) return value;

      value = value.substr(0, max);
      if (wordwise) {
        let lastspace = value.lastIndexOf(' ');
        if (lastspace !== -1) {
          //Also remove . and , so its gives a cleaner result.
          if (value.charAt(lastspace - 1) === '.' || value.charAt(lastspace - 1) === ',') {
            lastspace = lastspace - 1;
          }
          value = value.substr(0, lastspace);
        }
      }

      return value + (tail || ' …');
    };
  });
