using Game.Coords;
using Newtonsoft.Json;
using Models;

namespace Game.Events
{
    public abstract class Event { };

    public class GameStartedEvent : Event
    {
        public int black, white;
        public string map;
        public GameRule rule;
        public BallType turn;
    }

    public class EnteredEvent : Event
    {
        public int user;
    }

    public class LeftEvent : Event
    {
        public int user;
    }

    public class ConnectedEvent : Event
    {
        public Models.Room room;
    }

    public class MoveEvent : Event
    {
        public BallType player;
        public CubeCoord start;
        public CubeCoord end;
        public CubeCoord dir;
    }

    public class ConfedEvent : Event
    {
        public Conf conf;
    }

    public class ErrorEvent : Event
    {
        public string message;
    }

    public class EndedEvent : Event
    {
        public int loser;
        public BallType player;
        public string cause;
    }
}