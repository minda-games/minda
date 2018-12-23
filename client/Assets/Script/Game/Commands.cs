public abstract class Command { };

namespace Game
{
    public class ConnectCommand : Command
    {
        public string type = "connect";
        public string invite;

        public ConnectCommand(string invite)
        {
            this.invite = invite;
        }
    }

    public class MoveCommand : Command
    {
        public string type = "move";
        public CubeCoord start;
        public CubeCoord end;
        public CubeCoord dir;

        public MoveCommand(BallType player, CubeCoord start, CubeCoord end, CubeCoord dir)
        {
            this.start = start;
            this.end = end;
            this.dir = dir;
        }
    }

    public class GGCommand : Command
    {
        public string type = "gg";
    }
}