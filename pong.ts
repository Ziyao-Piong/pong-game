import { interval, fromEvent, from, zip, Observable, identity, animationFrameScheduler, empty } from 'rxjs'
import { map, scan, filter, takeUntil, merge, flatMap, take, concat, min, switchMap, takeWhile } from 'rxjs/operators'

function pong() {
    // Inside this function you will use the classes and functions 
    // from rx.js
    // to add visuals to the svg element in pong.html, animate them, and make them interactive.
    // Study and complete the tasks in observable exampels first to get ideas.
    // Course Notes showing Asteroids in FRP: https://tgdwyer.github.io/asteroids/ 
    // You will be marked on your functional programming style
    // as well as the functionality that you implement.
    // Document your code!  
  
  const
    Constants = new class {
      readonly GameRounds = 7;
      readonly StartPlayer2Speed = 4;
      readonly SpeedIncrement = 1;
      readonly MaxPlayer2Speed = 7;
      readonly BallSpeed = 3.3;
      readonly BallSpeedIncrement = 0.2;
      readonly MaxBallSpeed = 4.5;
      readonly MouseOffset = -100;
      readonly YMaxBall = 10;
      readonly comPaddleRange = 3;  // Acceptable range from the centre of the paddle
      readonly playerKeyboard = 17; // Speed of the player's paddle if player uses the keyboard to play
    }

  // a simple, seedable, pseudo-random number generator
  class RNG {
    // LCG using GCC's constants
    m = 0x80000000// 2**31
    a = 1103515245
    c = 12345
    state:number
    constructor(seed:number) {
      this.state = seed ? seed : Math.floor(Math.random() * (this.m - 1));
    }
    nextInt() {
      this.state = (this.a * this.state + this.c) % this.m;
      return this.state;
    }
    nextFloat() {
      // returns in range [0,1]
      return this.nextInt() / (this.m - 1);
    }
  }

  // A simple class that create a vector object with x and y
  class Vec {
    constructor(public readonly x: number = 0, public readonly y: number = 0) {}
    add = (b:Vec) => new Vec(this.x + b.x, this.y + b.y)
    sub = (b:Vec) => this.add(b.scale(-1))
    scale = (s:number) => new Vec(this.x*s,this.y*s)
    static Zero = new Vec();
  }


  type Body = Readonly<{
    id:string,
    pos:Vec,
    vel:Vec,
    radius:number,
    width:number,
    height:number,
    createTime:number
  }>

  type State = Readonly<{
    time:number,
    balls:Body,
    player1:Body,
    player2:Body,
    player2speed:number,
    score1:number,
    score2:number,
    player1Won:boolean,
    player2Won:boolean,
    roundEnds:boolean,
    gameOver:boolean,
  }>

  
  const svg = document.getElementById("canvas")!;

  // copy dimensions of canvas for easy access to the attributes
  const canvas: {width: number, height: number} = {
    width: parseInt(svg.getAttribute("width")!),
    height: parseInt(svg.getAttribute("height")!)
  }

  // create all body that should exist on the canvas
  const 
    player1 = document.createElementNS(svg.namespaceURI, 'rect'),
    player2 = document.createElementNS(svg.namespaceURI, 'rect'),
    ball = document.createElementNS(svg.namespaceURI, 'circle'),
    score1 = document.createElementNS(svg.namespaceURI, 'text'),
    score2 = document.createElementNS(svg.namespaceURI, 'text'),
    landing = document.createElementNS(svg.namespaceURI, 'text'),
    status = document.createElementNS(svg.namespaceURI, 'text')!,
    gameOverCanvas = document.createElementNS(svg.namespaceURI, 'rect')!,
    enterToPlay = document.createElementNS(svg.namespaceURI, 'text'),

    // a random number generator function
    rng = new RNG(20),
    nextRandom = ()=>rng.nextFloat()*2 - 1

  // Create the ball with the following initial state, the ball will go to the 
  // left upon creation
  const createBall = (time:number) => {
    return {
      id: 'ball',
      pos: new Vec(300, 300),
      vel: new Vec(-Constants.BallSpeed, 
                  nextRandom() > 0.5? 2 * nextRandom(): -2 * nextRandom()),
      radius:5.8,
      width:0,
      height:0,
      createTime:time
    }
  }

  // Create a paddle for the player that is placed on the right hand side
  function createPlayer1() : Body {
    return {
      id:'player1',
      pos: new Vec(575, 275), 
      vel:Vec.Zero,
      radius: 0,
      width: 7,
      height: 55,
      createTime:0
    }
  }

  // Create a paddle for the computer that is placed on the left hand side
  function createPlayer2() : Body {
    return {
      id:'player2',
      pos: new Vec(18, 275), 
      vel:Vec.Zero,
      radius: 0,
      width: 7,
      height: 55,
      createTime:0
    }
  }

  // Enable the paddle to perform wrap around function 
  const  
    initialState : State = {
      time:0,
      balls:createBall(0),
      player1:createPlayer1(),
      player2:createPlayer2(),
      player2speed:Constants.StartPlayer2Speed,
      score1:0,
      score2:0,
      player1Won:false,
      player2Won:false,
      roundEnds:false,
      gameOver:false
    },
    
    /**
     * Handle every round of the game, consistently checks if any of the players ie. Player or
     * the computer has won the round. Returns a state with updated position of computer's
     * paddle, updated score boards, and create a new ball at the centre of the canvas if 
     * either of the players has won the round.
     * @param s the state of the game
     */
    handleRound = (s:State) => {
      const 
        player1win = (ball:Body) => (ball.pos.x - ball.radius <= 0),
        player2win = (ball:Body) => (ball.pos.x + ball.radius >= canvas.width),
        gameEnds = (score:number) => score >= Constants.GameRounds? true : false

      return <State> {...s,
        balls: player1win(s.balls)||player2win(s.balls)? createBall(s.time) : s.balls, 
        player2: handlePlayer2(s),
        score1: player1win(s.balls)? s.score1 + 1: s.score1,
        score2: player2win(s.balls)? s.score2 + 1: s.score2,
        player1Won: gameEnds(s.score1),
        player2won: gameEnds(s.score2),
        roundEnds: player1win(s.balls) || player2win(s.balls),
        gameOver: gameEnds(s.score1) || gameEnds(s.score2)
      }
    },

    /**
     * Handle the "AI" of the computer paddle. The y-velocity of computer paddle will increase
     * as the score of the player increases until it reaches a max velocity for the paddle. 
     * The paddle will move upwards or downwards based on the position of the ball after the 
     * ball crosses the middle line in the direction towards the paddle. It will stay put otherwise.
     * @param s state of the game
     */
    handlePlayer2 = (s:State) => {
      // Compute the speed of the paddle in regard with the score of the player.
      const playerspeed = (speed:number) =>
        speed + (s.score1 * Constants.SpeedIncrement) < Constants.MaxPlayer2Speed ?
               speed + (s.score2 * Constants.SpeedIncrement)
               : Constants.MaxPlayer2Speed

      const moveY = () => 
        // In the direction of the paddle and in the left section of the canvas
        s.balls.vel.x < 0 && s.balls.pos.x < canvas.width/2 ? 
              // Check if the y-position of ball is out of the pre-defined hitting range of the paddle
              // The range here is 2 * constants.comPaddleRange with the middle being the centre position 
              // of the paddle. 
              (s.balls.pos.y < (s.player2.pos.y + s.player2.height/2 + Constants.comPaddleRange)) && 
              (s.balls.pos.y > (s.player2.pos.y + s.player2.height/2 - Constants.comPaddleRange))? 
                    s.player2.pos.y
                    // Decide if the paddle should move up or down
                    : (s.balls.pos.y < (s.player2.pos.y + s.player2.height/2))?
                          s.player2.pos.y - playerspeed(s.player2speed)
                          :s.player2.pos.y + playerspeed(s.player2speed)
          : s.player2.pos.y

      return <Body>{
      ...s.player2,
      pos: new Vec(s.player2.pos.x, moveY())
      }
    },

    /**
     * Handle the mechanics of the ball. The ball will bounce off the paddles by simply negating 
     * the direction of x-velocity of the ball. It will apply the same technique when it 
     * bounces off the ceiling and the ground but by negating the y-velocity. When it bounces 
     * off the paddle, the y-velocity of the ball depends on which part of the paddle the ball
     * strikes. If the ball hits the middle of the paddle, it will travel horizontally; the 
     * further from the centre, the greater the angle will be / greater y-velocity.
     * @param s state of the game
     */
    handleBall = (s:State) => {
      const
        // Check if the ball hits the player's paddle
        ballCollide1 = (ball:Body, paddle:Body) => 
          (ball.pos.y >= paddle.pos.y) && (ball.pos.y <= (paddle.pos.y + paddle.height)) &&
            (((ball.pos.x + ball.radius) >= (paddle.pos.x)) && 
            ((ball.pos.x + ball.radius) < (paddle.pos.x + s.balls.vel.x))),
        
        // Check if the ball hits the computer's paddle
        ballCollide2 = (ball:Body, paddle:Body) => 
          (ball.pos.y >= paddle.pos.y) && (ball.pos.y <= (paddle.pos.y + paddle.height)) &&
            (((ball.pos.x - ball.radius) <= (paddle.pos.x + paddle.width)) && 
            ((ball.pos.x - ball.radius) > (paddle.pos.x - s.balls.vel.x))),

        // Move the ball in the opposite direction if the ball touches the ceiling or the ground
        bounceOffWall = (v:number) =>
          v >= canvas.height-5 || v <= 5 ? s.balls.pos.sub(s.balls.vel).y 
                : s.balls.pos.add(s.balls.vel).y,
        
        // Move the ball in the opposite direction if the ball touches the paddle
        bounceOffPaddle = (v:number) =>
          v > canvas.width/2 ? ballCollide1(s.balls, s.player1) ? s.balls.pos.sub(s.balls.vel).x 
                                                                : s.balls.pos.add(s.balls.vel).x
                                : ballCollide2(s.balls, s.player2) ? s.balls.pos.sub(s.balls.vel).x 
                                                                  : s.balls.pos.add(s.balls.vel).x,
         
        // Change the direction of the ball from going left to going right and vice versa.
        changeXdir = (v:number) => 
          s.balls.pos.x > canvas.width/2 ? ballCollide1(s.balls, s.player1) ? -changeXSpeed(v) : changeXSpeed(v)
                                : ballCollide2(s.balls, s.player2) ? -changeXSpeed(v) : changeXSpeed(v),
 
        // Increase the x velocity of the ball as the score of player 1 increases
        changeXSpeed = (v:number) =>
          v > 0 ? (v + Constants.BallSpeedIncrement) < Constants.MaxBallSpeed ?
                            (v + Constants.BallSpeedIncrement)
                            : Constants.MaxBallSpeed
                : (v - Constants.BallSpeedIncrement) > -Constants.MaxBallSpeed ?
                            (v - Constants.BallSpeedIncrement)
                            : -Constants.MaxBallSpeed,

        // Calculate the normalised relative y intersection [-1..1] between the ball and the paddle, then
        // return new y velocity of the ball.
        relativeYintersect = (paddle:Body) => s.balls.pos.y - (paddle.pos.y + paddle.height/2),
        normalisedRelativeYintersect = (paddle:Body) => relativeYintersect(paddle)/(paddle.height/2),
        newY = (paddle:Body) => normalisedRelativeYintersect(paddle) * Constants.YMaxBall,
        
        // Check if the ball hit the ceiling or the ground
        hitWall = () => s.balls.pos.y >= canvas.height-5 || s.balls.pos.y <= 5,
        
        // Change the direction of y-velocity of the ball when the ball hits the ceiling or the
        // ground, or return a new y-velocity relative to the part of the paddle the ball strikes. 
        changeYdir = (v:number) => 
          hitWall() ? ballCollide1(s.balls, s.player1) ? newY(s.player1)
                            : ballCollide2(s.balls, s.player2) ? newY(s.player2)
                                                                  : -v
                    : ballCollide1(s.balls, s.player1) ? newY(s.player1)
                            : ballCollide2(s.balls, s.player2) ? newY(s.player2)
                                                                  : v

        return <Body>{...s.balls,
          pos: new Vec(bounceOffPaddle(s.balls.pos.x), bounceOffWall(s.balls.pos.y)),
          vel: new Vec(changeXdir(s.balls.vel.x), changeYdir(s.balls.vel.y))
        }
    },

    // Update the state at every emission of the interval stream.
    tick = (s:State,elapsed:number) => {
      return handleRound({...s,
        balls: handleBall(s),
      })
    }


/////////////////////////////////////////////////////////////////////////////////


  class Tick { constructor(public readonly elapsed:number) {} }
  class Player1Key { constructor(public readonly direction:number) {} }
  class Player1Mouse { constructor(public readonly direction:number) {} }

  type Event = 'keydown' | 'keyup'
  type Key = 'ArrowUp' | 'ArrowDown'  

  const observeKey = <T>(eventName:Event, k:Key, result:()=>T)=>
    fromEvent<KeyboardEvent>(document,eventName)
      .pipe(
        filter(({code})=>code === k),
        map(result)),

    startMoveUp$ = observeKey('keydown','ArrowUp',()=>new Player1Key(-Constants.playerKeyboard)),
    startMoveDown$ = observeKey('keydown','ArrowDown',()=>new Player1Key(Constants.playerKeyboard)),
    stopMoveUp$ = observeKey('keyup','ArrowUp',()=>new Player1Key(0)),
    stopMoveDown$ = observeKey('keyup','ArrowDown',()=>new Player1Key(0)),

    mouseMove$ = fromEvent<MouseEvent>(document, 'mousemove').pipe(
          map(v => new Player1Mouse(v.clientY + Constants.MouseOffset))),
  
    // Allow the paddle to perform wrap around functionality
    torusWrap = ({x,y}:Vec) => { 
      const wrap = (v:number) => 
        v < 0 ? v + canvas.height : v > canvas.height ? v - canvas.height : v;
      return new Vec(wrap(x),wrap(y))
    }

  /**
   * Reduce or update the state of the game at each interval stream emission.
   * @param s state of the game
   * @param e type of the stream
   */
  const reduceState = (s:State, e:Tick|Player1Key|Player1Mouse)=>
    e instanceof Player1Key ? {...s,
      player1: {...s.player1, pos: torusWrap(new Vec(s.player1.pos.x, s.player1.pos.y + e.direction))}
    } :
    // Use the client y of the mouse pointer as the y position of the player's paddle  
    e instanceof Player1Mouse ? {...s,
      player1: {...s.player1, pos: new Vec(s.player1.pos.x, e.direction)}
    } : tick(s, e.elapsed) 
  
  // Append the landing page onto the svg canvas
  Object.entries({
    id:'Landing',
    x: 120, y: 300,
    fill: 'white',
    'font-size':30,
    visibility:'visible',
  }).forEach(([key,val])=>landing.setAttribute(key,String(val)))
  landing.textContent = "Press 'Enter' to start playing!";
  svg.appendChild(landing);


  const 
    // Observable stream that listen to 'Enter' key to restart the game
    restart$ = fromEvent<KeyboardEvent>(document, 'keydown')
        .pipe(
          filter(({key}) => key === 'Enter'),
          filter(({repeat})=>!repeat),
          map(()=>startGame(initialState)),
        ).subscribe(restartView)

  /**
   * Observable stream for one complete game.
   * @param initialstate the initial state of the game where the score is 0 : 0
   */
  function startGame(initialstate:State){
      interval(10)
        .pipe(
          map(elapsed=>new Tick(elapsed)),
          merge(startMoveUp$,startMoveDown$,stopMoveUp$,stopMoveDown$),
          merge(mouseMove$),
          scan(reduceState, initialstate),
          takeWhile(s => !s.gameOver, true)
      ).subscribe(updateView)
      return initialstate
    }
  
  // Hide the game over page when the game is restarted
  function restartView (s: State) : void {
    gameOverCanvas.setAttribute('visibility', 'hidden')
    status.setAttribute('visibility', 'hidden')
    enterToPlay.setAttribute('visibility', 'hidden')
  }

  /**
   * Update the svg elements on the canvas according to the latest version of state.
   * @param s state of the game
   */
  function updateView (s: State) : void {
    // Hide the landing page 
    landing.setAttribute('visibility', 'hidden')

    // Update the position of the player's paddle
    Object.entries({
      id: s.player1.id,
      x: s.player1.pos.x, y: s.player1.pos.y,
      width: s.player1.width, height: s.player1.height,
      fill: '#95B3D7',
    }).forEach(([key,val])=>player1.setAttribute(key,String(val)))
    svg.appendChild(player1);

    // Update the position of the computer's paddle
    Object.entries({
      id: s.player2.id,
      x: s.player2.pos.x, y: s.player2.pos.y,
      width: s.player2.width, height: s.player2.height,
      fill: '#95B3D7',
    }).forEach(([key,val])=>player2.setAttribute(key,String(val)))
    svg.appendChild(player2);

    // Update the position of the ball
    Object.entries({
      id: s.balls.id,
      cx: s.balls.pos.x, cy: s.balls.pos.y,
      r: s.balls.radius,
      fill: '#95B3D7',
    }).forEach(([key,val])=>ball.setAttribute(key,String(val)))
    svg.appendChild(ball);

    // Update the score of the player
    Object.entries({
      x: 420, y: 110,
      fill: 'white',
      'font-size':110,
      'fill-opacity':0.4,
    }).forEach(([key,val])=>score1.setAttribute(key,String(val)))
    score1.textContent = String(s.score1)
    svg.appendChild(score1)

    // Update the score of the computer
    Object.entries({
      x: 120, y: 110,
      fill: 'white',
      'font-size':110,
      'fill-opacity':0.4,
    }).forEach(([key,val])=>score2.setAttribute(key,String(val)))
    score2.textContent = String(s.score2)
    svg.appendChild(score2)      

    if (s.gameOver) {
      svg.removeChild(document.getElementById('ball'))
      // A translucent white layer that overlays the canvas whent the game is over.
      Object.entries({
        id:'GOcanvas',
        x: 0, y: 0,
        width:canvas.width, height:canvas.height,
        fill: 'white',
        'fill-opacity':0.2,
        visibility:'visible'
      }).forEach(([key,val])=>gameOverCanvas.setAttribute(key,String(val)))
      svg.appendChild(gameOverCanvas);
      
      // Display the result of the game.
      Object.entries({
        id:'Status',
        x: 150, y: 300,
        fill: 'white',
        'font-size':50,
        visibility:'visible',
      }).forEach(([key,val])=>status.setAttribute(key,String(val)))
      status.textContent = s.player1Won? "Player WINS!!!" : "Player Loses...";
      svg.appendChild(status);

      // Display the instruction for the player to press enter to play again
      Object.entries({
        id:'EnterToPlay',
        x: 197, y: 350,
        fill: 'white',
        'font-size':15,
        visibility:'visible',
      }).forEach(([key,val])=>enterToPlay.setAttribute(key,String(val)))
      enterToPlay.textContent = "Press 'Enter' to play again! :)";
      svg.appendChild(enterToPlay);
    }
  }
}

  // the following simply runs your pong function on window load.  Make sure to leave it in place.
  if (typeof window != 'undefined')
    window.onload = ()=>{
      pong();
    }